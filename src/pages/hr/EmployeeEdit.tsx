import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import AvailabilityEditor from '../../components/AvailabilityEditor';
import { todayYMD, WEEKDAY_SHORT } from '../../lib/dates';
import { useAuth } from '../../lib/auth';
import { employeeColor, errorMessage, loadLeaveTypes, useLoad } from '../../lib/data';
import { defaultEntitlement } from '../../lib/leaveBalance';
import { SHG_LABELS, type ShgFund } from '../../lib/payroll/shg';
import { callAdminUsers, must, supabase } from '../../lib/supabase';
import type { Employee, LeaveEntitlement, Profile } from '../../lib/types';

type Draft = Omit<Employee, 'id' | 'user_id'>;

const BLANK: Draft = {
  emp_code: '',
  full_name: '',
  email: '',
  phone: '',
  job_title: '',
  outlet: '',
  color: null,
  employment_type: 'FT',
  monthly_basic: null,
  hourly_rate: 14,
  fixed_allowance: 0,
  ot_eligible: true,
  work_days: [1, 2, 3, 4, 5],
  contract_hours_per_week: null,
  dob: null,
  residency: 'SC',
  pr_start_date: null,
  pr_scheme: 'GG',
  shg_fund: 'NONE',
  nric_last4: '',
  start_date: todayYMD(),
  end_date: null,
  active: true,
};

export function tempPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint32Array(10));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

// Keyed by id so going from one employee (or "new") to another starts with a fresh form.
export default function EmployeeEditRoute() {
  const { id } = useParams();
  return <EmployeeEdit key={id} />;
}

/** Turns database errors HR might hit into plain English. */
function friendlyError(err: unknown): string {
  const msg = errorMessage(err);
  if (msg.includes('employees_emp_code_key')) return 'Another employee already has this employee code.';
  return msg;
}

function EmployeeEdit() {
  const { id } = useParams();
  const isNew = id === 'new';
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [userId, setUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!isNew);
  const [tab, setTab] = useState<'details' | 'login' | 'leave' | 'availability'>('details');

  useEffect(() => {
    if (isNew) return;
    supabase
      .from('employees')
      .select('*')
      .eq('id', id!)
      .single()
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else {
          const { id: _id, user_id, ...rest } = data as Employee;
          setDraft(rest);
          setUserId(user_id);
        }
        setLoading(false);
      });
  }, [id, isNew]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setSaved(false);
  };
  const num = (v: string) => (v === '' ? null : Number(v));
  const str = (v: string) => (v.trim() === '' ? null : v);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const payload = {
      ...draft,
      emp_code: str(draft.emp_code ?? ''),
      email: str(draft.email ?? ''),
      nric_last4: str((draft.nric_last4 ?? '').toUpperCase()),
      monthly_basic: draft.employment_type === 'FT' ? draft.monthly_basic : null,
      hourly_rate: draft.employment_type === 'PT' ? draft.hourly_rate : null,
      pr_start_date: draft.residency === 'PR' ? draft.pr_start_date : null,
    };
    try {
      if (isNew) {
        const created = must(await supabase.from('employees').insert(payload).select('id').single()) as { id: string };
        navigate(`/hr/employees/${created.id}`, { replace: true });
      } else {
        must(await supabase.from('employees').update(payload).eq('id', id!));
        setSaved(true);
      }
    } catch (err) {
      setError(friendlyError(err));
      // The message is shown above the form, which may be scrolled out of view.
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    setBusy(false);
  }

  async function remove() {
    if (!confirm(`Delete ${draft.full_name} and ALL their shifts, leave and payslips? For staff who have left, set an end date and untick "Active" instead.`)) return;
    try {
      if (userId) await callAdminUsers({ action: 'delete', user_id: userId });
      must(await supabase.from('employees').delete().eq('id', id!));
      navigate('/hr/employees');
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (loading) return <div className="loading">Loading…</div>;
  const isFT = draft.employment_type === 'FT';
  const otHint =
    isFT && (draft.monthly_basic ?? 0) > 2600
      ? 'Basic is above $2,600: OT is only required by law for workmen earning up to $4,500. Tick it if their contract pays OT.'
      : 'Employees earning up to $2,600 (or workmen up to $4,500) must be paid OT under the Employment Act.';

  return (
    <>
      <div className="page-head">
        <div>
          <Link to="/hr/employees" className="small">← Employees</Link>
          <h1 style={{ marginTop: 4 }}>{isNew ? 'New employee' : draft.full_name}</h1>
        </div>
        {!isNew && (
          <button className="btn btn-danger" onClick={remove}>
            Delete employee
          </button>
        )}
      </div>

      {!isNew && (
        <div className="tabs">
          {(['details', 'login', 'leave', 'availability'] as const).map((t) => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {{ details: 'Details', login: 'Login', leave: 'Leave entitlement', availability: 'Availability' }[t]}
            </button>
          ))}
        </div>
      )}

      {error && <div className="alert error">{error}</div>}

      {tab === 'details' && (
        <form className="card" onSubmit={save}>
          <div className="form-grid">
            <div className="section-title" style={{ borderTop: 0, marginTop: 0, paddingTop: 0 }}>Personal</div>
            <label className="field span-2">
              Full name *
              <input required value={draft.full_name} onChange={(e) => set('full_name', e.target.value)} />
            </label>
            <label className="field">
              Employee code
              <input value={draft.emp_code ?? ''} onChange={(e) => set('emp_code', e.target.value)} placeholder="e.g. M001" />
            </label>
            <label className="field">
              Email
              <input type="email" value={draft.email ?? ''} onChange={(e) => set('email', e.target.value)} />
            </label>
            <label className="field">
              Phone
              <input value={draft.phone ?? ''} onChange={(e) => set('phone', e.target.value)} />
            </label>
            <label className="field">
              Date of birth <span className="hint">(sets CPF age band)</span>
              <input type="date" value={draft.dob ?? ''} onChange={(e) => set('dob', e.target.value || null)} />
            </label>
            <label className="field">
              NRIC/FIN (last 4 only)
              <input maxLength={4} value={draft.nric_last4 ?? ''} onChange={(e) => set('nric_last4', e.target.value)} placeholder="e.g. 567A" />
            </label>
            <label className="field">
              Calendar colour
              <input type="color" value={draft.color ?? (isNew ? '#2563eb' : employeeColor({ id: id!, color: null }))} onChange={(e) => set('color', e.target.value)} />
            </label>

            <div className="section-title">Job</div>
            <label className="field">
              Job title
              <input value={draft.job_title ?? ''} onChange={(e) => set('job_title', e.target.value)} />
            </label>
            <label className="field">
              Outlet / department
              <input value={draft.outlet ?? ''} onChange={(e) => set('outlet', e.target.value)} />
            </label>
            <label className="field">
              Start date *
              <input type="date" required value={draft.start_date} onChange={(e) => set('start_date', e.target.value)} />
            </label>
            <label className="field">
              Last day <span className="hint">(if leaving)</span>
              <input type="date" value={draft.end_date ?? ''} onChange={(e) => set('end_date', e.target.value || null)} />
            </label>
            <label className="check" style={{ alignSelf: 'end', paddingBottom: 8 }}>
              <input type="checkbox" checked={draft.active} onChange={(e) => set('active', e.target.checked)} /> Active (included in roster and payroll)
            </label>

            <div className="section-title">Pay</div>
            <label className="field">
              Employment type
              <select
                value={draft.employment_type}
                onChange={(e) => set('employment_type', e.target.value as 'FT' | 'PT')}
              >
                <option value="FT">Full-time (monthly salary)</option>
                <option value="PT">Part-time (hourly)</option>
              </select>
            </label>
            {isFT ? (
              <label className="field">
                Monthly basic salary ($)
                <input type="number" min="0" step="0.01" value={draft.monthly_basic ?? ''} onChange={(e) => set('monthly_basic', num(e.target.value))} />
              </label>
            ) : (
              <label className="field">
                Hourly rate ($)
                <input type="number" min="0" step="0.01" value={draft.hourly_rate ?? ''} onChange={(e) => set('hourly_rate', num(e.target.value))} />
              </label>
            )}
            <label className="field">
              Fixed monthly allowance ($)
              <input type="number" min="0" step="0.01" value={draft.fixed_allowance} onChange={(e) => set('fixed_allowance', Number(e.target.value || 0))} />
            </label>
            <div className="span-2">
              <div className="field" style={{ marginBottom: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 550, color: 'var(--muted)' }}>Normal working days</span>
              </div>
              <div className="row">
                {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                  <label key={d} className="check">
                    <input
                      type="checkbox"
                      checked={draft.work_days.includes(d)}
                      onChange={(e) => set('work_days', e.target.checked ? [...draft.work_days, d].sort() : draft.work_days.filter((x) => x !== d))}
                    />
                    {WEEKDAY_SHORT[d]}
                  </label>
                ))}
              </div>
              <div className="muted small">Used for leave days, unpaid-leave deductions and rest-day pay.</div>
            </div>
            {!isFT && (
              <label className="field">
                Contract hours per week
                <input type="number" min="0" step="0.5" value={draft.contract_hours_per_week ?? ''} onChange={(e) => set('contract_hours_per_week', num(e.target.value))} />
                <span className="hint">Pro-rates leave and leave pay</span>
              </label>
            )}
            <div className="span-3">
              <label className="check">
                <input type="checkbox" checked={draft.ot_eligible} onChange={(e) => set('ot_eligible', e.target.checked)} /> Paid overtime (1.5×)
              </label>
              <div className="muted small">{otHint}</div>
            </div>

            <div className="section-title">CPF</div>
            <label className="field">
              Residency
              <select value={draft.residency} onChange={(e) => set('residency', e.target.value as Draft['residency'])}>
                <option value="SC">Singapore Citizen</option>
                <option value="PR">Permanent Resident</option>
                <option value="FOREIGNER">Foreigner (no CPF)</option>
              </select>
            </label>
            {draft.residency === 'PR' && (
              <>
                <label className="field">
                  PR obtained on
                  <input type="date" value={draft.pr_start_date ?? ''} onChange={(e) => set('pr_start_date', e.target.value || null)} />
                </label>
                <label className="field">
                  PR CPF rates (first 2 years)
                  <select value={draft.pr_scheme} onChange={(e) => set('pr_scheme', e.target.value as Draft['pr_scheme'])}>
                    <option value="GG">Graduated (default)</option>
                    <option value="FG">Full employer, graduated employee</option>
                    <option value="FF">Full rates (joint application)</option>
                  </select>
                </label>
              </>
            )}
            <label className="field">
              Self-help group fund
              <select value={draft.shg_fund} onChange={(e) => set('shg_fund', e.target.value as ShgFund)}>
                {(Object.keys(SHG_LABELS) as ShgFund[]).map((k) => (
                  <option key={k} value={k}>{SHG_LABELS[k]}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="row mt">
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : isNew ? 'Create employee' : 'Save changes'}</button>
            {saved && <span className="badge ok">Saved</span>}
          </div>
        </form>
      )}

      {tab === 'login' && !isNew && (
        <LoginCard employeeId={id!} email={draft.email ?? ''} userId={userId} onChange={setUserId} />
      )}
      {tab === 'leave' && !isNew && <EntitlementCard employee={{ ...draft, id: id!, user_id: userId }} />}
      {tab === 'availability' && !isNew && (
        <div className="card">
          <AvailabilityEditor employeeId={id!} />
        </div>
      )}
    </>
  );
}

function LoginCard({ employeeId, email: initialEmail, userId, onChange }: { employeeId: string; email: string; userId: string | null; onChange: (id: string | null) => void }) {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState(tempPassword());
  const [shown, setShown] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [unlinked, setUnlinked] = useState<Profile[]>([]);
  const [linkTo, setLinkTo] = useState('');
  const auth = useAuth();
  const isMe = userId != null && userId === auth.session?.user.id;

  useEffect(() => {
    if (!userId) {
      setProfile(null);
      // Logins not yet attached to any employee, e.g. the HR account created in the Supabase dashboard
      Promise.all([supabase.from('profiles').select('*'), supabase.from('employees').select('user_id').not('user_id', 'is', null)]).then(([p, e]) => {
        const taken = new Set((e.data ?? []).map((x: { user_id: string }) => x.user_id));
        setUnlinked(((p.data ?? []) as Profile[]).filter((x) => !taken.has(x.id)));
      });
      return;
    }
    supabase.from('profiles').select('*').eq('id', userId).maybeSingle().then(({ data }) => setProfile(data as Profile));
  }, [userId]);

  const link = () =>
    run(async () => {
      const p = unlinked.find((x) => x.id === linkTo);
      if (!p) return;
      must(await supabase.from('employees').update({ user_id: p.id, email: p.email }).eq('id', employeeId));
      onChange(p.id);
      setShown(null);
      // Linking your own login adds the "Me" pages to the menu straight away.
      if (p.id === auth.session?.user.id) await auth.refresh();
    });

  // Unlinking keeps the login (e.g. HR's own) but detaches it from this employee record.
  const unlink = () =>
    run(async () => {
      if (!confirm('Detach this login from the employee record? The login itself is kept.')) return;
      must(await supabase.from('employees').update({ user_id: null }).eq('id', employeeId));
      onChange(null);
      if (isMe) await auth.refresh();
    });

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err));
    }
    setBusy(false);
  }

  const create = () =>
    run(async () => {
      const res = await callAdminUsers({ action: 'create', employee_id: employeeId, email: email.trim(), password });
      setShown(`Login created. Give ${email.trim()} this temporary password: ${password}`);
      onChange(res.user_id as string);
    });

  const reset = () =>
    run(async () => {
      const pw = tempPassword();
      await callAdminUsers({ action: 'reset_password', user_id: userId!, password: pw });
      setShown(`Password reset. New temporary password: ${pw}`);
    });

  const removeLogin = () =>
    run(async () => {
      if (!confirm('Remove this login? Their records stay; they just can no longer sign in.')) return;
      await callAdminUsers({ action: 'delete', user_id: userId! });
      onChange(null);
      setShown(null);
    });

  const toggleHR = () =>
    run(async () => {
      const role = profile?.role === 'hr' ? 'employee' : 'hr';
      must(await supabase.from('profiles').update({ role }).eq('id', userId!));
      setProfile((p) => (p ? { ...p, role } : p));
    });

  return (
    <div className="card stack" style={{ maxWidth: 560 }}>
      {error && <div className="alert error">{error}</div>}
      {shown && (
        <div className="alert ok">
          {shown}
          <div className="small">They'll be asked to choose their own password the first time they sign in.</div>
        </div>
      )}
      {userId ? (
        <>
          <p>
            Signs in as <strong>{profile?.email ?? initialEmail}</strong>
            {profile && <span className={`badge ${profile.role === 'hr' ? 'info' : ''}`} style={{ marginLeft: 8 }}>{profile.role === 'hr' ? 'HR access' : 'Employee'}</span>}
          </p>
          <div className="row">
            <button className="btn" onClick={reset} disabled={busy}>Reset password</button>
            {/* Removing your own HR access or login would lock you out, so those need another HR user. */}
            {!isMe && (
              <button className="btn" onClick={toggleHR} disabled={busy || !profile}>
                {profile?.role === 'hr' ? 'Remove HR access' : 'Give HR access'}
              </button>
            )}
            <button className="btn" onClick={unlink} disabled={busy}>Detach</button>
            {!isMe && <button className="btn btn-danger" onClick={removeLogin} disabled={busy}>Remove login</button>}
          </div>
          {isMe && <p className="muted small">This is your own login. Another HR user can change its HR access or remove it.</p>}
        </>
      ) : (
        <>
          <p className="muted">Create a login so this employee can see their shifts, set availability, apply for leave and download payslips.</p>
          <label className="field">
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="field">
            Temporary password
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <input value={password} onChange={(e) => setPassword(e.target.value)} />
              <button type="button" className="btn" onClick={() => setPassword(tempPassword())}>New</button>
            </div>
          </label>
          <div>
            <button className="btn btn-primary" onClick={create} disabled={busy || !email || password.length < 8}>
              Create login
            </button>
          </div>
          {unlinked.length > 0 && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <p className="muted small">Or link a login that already exists (e.g. your own HR login, so you get payslips too):</p>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <select value={linkTo} onChange={(e) => setLinkTo(e.target.value)}>
                  <option value="">Choose a login…</option>
                  {unlinked.map((p) => <option key={p.id} value={p.id}>{p.email}{p.role === 'hr' ? ' (HR)' : ''}</option>)}
                </select>
                <button className="btn" onClick={link} disabled={busy || !linkTo}>Link</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function EntitlementCard({ employee }: { employee: Employee }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const types = useLoad(loadLeaveTypes, []);
  const rows = useLoad(
    async () => must(await supabase.from('leave_entitlements').select('*').eq('employee_id', employee.id).eq('year', year)) as LeaveEntitlement[],
    [employee.id, year],
  );
  const [values, setValues] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setValues(Object.fromEntries((rows.data ?? []).map((r) => [r.leave_type, String(r.days)])));
  }, [rows.data]);

  async function save() {
    setMsg(null);
    try {
      for (const t of (types.data ?? []).filter((t) => t.track_balance)) {
        const v = values[t.code];
        if (v == null || v === '') {
          must(await supabase.from('leave_entitlements').delete().match({ employee_id: employee.id, year, leave_type: t.code }));
        } else {
          must(
            await supabase
              .from('leave_entitlements')
              .upsert({ employee_id: employee.id, year, leave_type: t.code, days: Number(v) }, { onConflict: 'employee_id,year,leave_type' }),
          );
        }
      }
      setMsg('Saved');
      rows.reload();
    } catch (err) {
      setMsg(errorMessage(err));
    }
  }

  return (
    <div className="card" style={{ maxWidth: 640 }}>
      <div className="card-head">
        <h2>Leave entitlement</h2>
        <select value={year} onChange={(e) => setYear(Number(e.target.value))} style={{ width: 110 }}>
          {[year - 1, year, year + 1].map((y) => <option key={y}>{y}</option>)}
        </select>
      </div>
      <p className="muted small">
        Leave blank to use the default: Employment Act minimums for annual and sick leave (pro-rated for part-timers and new joiners).
        Enter a number to give more, e.g. contractual annual leave or carried-forward days.
      </p>
      <table className="table">
        <thead>
          <tr><th>Leave type</th><th className="num">Default</th><th style={{ width: 140 }}>This year</th></tr>
        </thead>
        <tbody>
          {(types.data ?? []).filter((t) => t.track_balance).map((t) => (
            <tr key={t.code}>
              <td>{t.name}</td>
              <td className="num">{defaultEntitlement(employee, t, year) ?? '—'}</td>
              <td>
                <input type="number" min="0" step="0.5" placeholder="default" value={values[t.code] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [t.code]: e.target.value }))} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row mt">
        <button className="btn btn-primary" onClick={save}>Save entitlement</button>
        {msg && <span className={`badge ${msg === 'Saved' ? 'ok' : 'danger'}`}>{msg}</span>}
      </div>
    </div>
  );
}
