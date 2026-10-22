import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Modal from '../../components/Modal';
import PayslipDoc from '../../components/PayslipDoc';
import { MONTH_NAMES, todayYMD } from '../../lib/dates';
import { errorMessage, fmtMoney, loadSettings, useLoad } from '../../lib/data';
import { downloadWorkbook } from '../../lib/excel';
import { AGE_BAND_LABELS, SCHEME_LABELS } from '../../lib/payroll/cpf';
import { calculateFor, defaultPayDate, loadRunContext, payrollEmployees, payslipRow, recalculateRun, type RunContext } from '../../lib/payroll/generate';
import type { ExtraDeduction, ExtraEarning, PayrollOverrides, WageType } from '../../lib/payroll/pay';
import { must, supabase } from '../../lib/supabase';
import type { CompanySettings, Employee, PayrollRun, Payslip } from '../../lib/types';

export default function PayrollRunPage() {
  const params = useParams();
  const year = Number(params.year);
  const month = Number(params.month);
  const navigate = useNavigate();
  const [run, setRun] = useState<PayrollRun | null>(null);
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Payslip | null>(null);
  const [ctx, setCtx] = useState<RunContext | null>(null);
  const settings = useLoad(loadSettings, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = must(await supabase.from('payroll_runs').select('*').eq('year', year).eq('month', month).maybeSingle()) as PayrollRun | null;
      setRun(r);
      if (r) {
        const ps = must(await supabase.from('payslips').select('*').eq('run_id', r.id)) as Payslip[];
        ps.sort((a, b) => a.result.employee.full_name.localeCompare(b.result.employee.full_name));
        setPayslips(ps);
      } else setPayslips([]);
    } catch (err) {
      setError(errorMessage(err));
    }
    setLoading(false);
  }, [year, month]);

  useEffect(() => {
    load();
  }, [load]);

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
    setBusy(false);
  }

  const create = () =>
    act(async () => {
      const payDay = settings.data?.payroll.pay_day ?? 7;
      const r = must(await supabase.from('payroll_runs').insert({ year, month, pay_date: defaultPayDate(year, month, payDay) }).select().single()) as PayrollRun;
      await recalculateRun(r, []);
    });

  const recalc = () => act(async () => { await recalculateRun(run!, payslips); setCtx(null); });

  const finalize = () => {
    const warnCount = payslips.filter((p) => p.result.warnings.length).length;
    const msg = `Finalise ${MONTH_NAMES[month - 1]} ${year}? Payslips become visible to employees and can't be edited unless you reopen the run.` +
      (warnCount ? `\n\n${warnCount} payslip(s) still have warnings.` : '');
    if (!confirm(msg)) return;
    act(async () => {
      must(await supabase.from('payslips').update({ status: 'finalized' }).eq('run_id', run!.id));
      must(await supabase.from('payroll_runs').update({ status: 'finalized', finalized_at: new Date().toISOString() }).eq('id', run!.id));
    });
  };

  const reopen = () => {
    if (!confirm('Reopen this payroll? Employees will stop seeing these payslips until you finalise again.')) return;
    act(async () => {
      must(await supabase.from('payroll_runs').update({ status: 'draft', finalized_at: null }).eq('id', run!.id));
      must(await supabase.from('payslips').update({ status: 'draft' }).eq('run_id', run!.id));
    });
  };

  const removeRun = () => {
    if (!confirm('Delete this draft payroll and all its payslips?')) return;
    act(async () => {
      must(await supabase.from('payroll_runs').delete().eq('id', run!.id));
    });
  };

  const setPayDate = (d: string) => act(async () => { must(await supabase.from('payroll_runs').update({ pay_date: d || null }).eq('id', run!.id)); });

  async function openEditor(p: Payslip) {
    try {
      if (!ctx) setCtx(await loadRunContext(year, month));
      setEditing(p);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const missing = useMemo(() => {
    if (!ctx) return [];
    return payrollEmployees(ctx).filter((e) => !payslips.some((p) => p.employee_id === e.id));
  }, [ctx, payslips]);

  useEffect(() => {
    if (run && run.status === 'draft' && !ctx) loadRunContext(year, month).then(setCtx).catch(() => undefined);
  }, [run, ctx, year, month]);

  const totals = useMemo(() => {
    const sum = (f: (p: Payslip) => number) => payslips.reduce((a, p) => a + f(p), 0);
    return {
      gross: sum((p) => p.result.grossWages),
      earnings: sum((p) => p.result.totalEarnings),
      cpfEE: sum((p) => p.result.cpf.employee),
      cpfER: sum((p) => p.result.cpf.employer),
      shg: sum((p) => p.result.shg),
      sdl: sum((p) => p.result.sdl),
      net: sum((p) => p.result.net),
    };
  }, [payslips]);

  function exportExcel() {
    const head = ['Employee', 'Code', 'NRIC (last 4)', 'Type', 'CPF rates', 'Age band', 'Hours', 'OT hours', 'Ordinary wages', 'Additional wages', 'Total wages',
      'CPF employee', 'CPF employer', 'CPF total', 'SHG fund', 'SHG amount', 'SDL', 'Total earnings', 'Total deductions', 'Net pay'];
    const rows = payslips.map((p) => {
      const r = p.result;
      return [r.employee.full_name, r.employee.emp_code, r.employee.nric_last4, r.employee.employment_type, r.cpf.scheme ? SCHEME_LABELS[r.cpf.scheme] : 'No CPF',
        r.cpf.ageBand ? AGE_BAND_LABELS[r.cpf.ageBand] : '', r.hours.worked, r.hours.ot, r.ow, r.aw, r.grossWages, r.cpf.employee, r.cpf.employer, r.cpf.total,
        r.shgFund === 'NONE' ? '' : r.shgFund, r.shg, r.sdl, r.totalEarnings, r.totalDeductions, r.net];
    });
    const total = ['TOTAL', '', '', '', '', '', '', '', '', '', totals.gross, totals.cpfEE, totals.cpfER, totals.cpfEE + totals.cpfER, '', totals.shg, totals.sdl, totals.earnings, '', totals.net];
    const lines = payslips.flatMap((p) => [
      ...p.result.earnings.map((e) => [p.result.employee.full_name, 'Earning', e.label, e.detail ?? '', e.wageType, e.amount]),
      ...p.result.deductions.map((d) => [p.result.employee.full_name, 'Deduction', d.label, d.detail ?? '', '', -d.amount]),
    ]);
    downloadWorkbook(`Payroll ${year}-${String(month).padStart(2, '0')}.xlsx`, [
      { name: 'Summary', rows: [head, ...rows, total], widths: [24, 8, 10, 5, 16, 12, 7, 8, 12, 12, 12, 12, 12, 10, 8, 10, 7, 13, 14, 11] },
      { name: 'Line items', rows: [['Employee', 'Kind', 'Item', 'Detail', 'CPF', 'Amount'], ...lines], widths: [24, 10, 30, 40, 6, 12] },
    ]);
  }

  async function removePayslip(p: Payslip) {
    if (!confirm(`Remove ${p.result.employee.full_name} from this payroll?`)) return;
    act(async () => { must(await supabase.from('payslips').delete().eq('id', p.id)); });
  }

  async function addEmployee(e: Employee) {
    act(async () => {
      const c = ctx ?? (await loadRunContext(year, month));
      must(await supabase.from('payslips').insert(payslipRow(run!, e, {}, calculateFor(c, e, {}))));
    });
  }

  const isDraft = run?.status === 'draft';

  return (
    <>
      <div className="page-head">
        <div>
          <Link to="/hr/payroll" className="small">← Payroll</Link>
          <h1 style={{ marginTop: 4 }}>
            {MONTH_NAMES[month - 1]} {year}{' '}
            {run && <span className={`badge ${isDraft ? 'warn' : 'ok'}`} style={{ verticalAlign: 'middle' }}>{isDraft ? 'Draft' : 'Finalised'}</span>}
          </h1>
        </div>
        {run && (
          <div className="row">
            <button className="btn" onClick={exportExcel} disabled={!payslips.length}>Export to Excel</button>
            <button className="btn" onClick={() => navigate(`/payslips/run/${run.id}`)} disabled={!payslips.length}>Print all payslips</button>
            {isDraft ? (
              <>
                <button className="btn" onClick={recalc} disabled={busy}>Recalculate</button>
                <button className="btn btn-primary" onClick={finalize} disabled={busy || !payslips.length}>Finalise</button>
              </>
            ) : (
              <button className="btn" onClick={reopen} disabled={busy}>Reopen</button>
            )}
          </div>
        )}
      </div>
      {error && <div className="alert error">{error}</div>}

      {loading ? (
        <div className="loading">Loading…</div>
      ) : !run ? (
        <div className="card empty">
          <p>No payroll for this month yet.</p>
          <p className="small">Before you start, make sure this month's timesheets are confirmed and leave is approved.</p>
          <button className="btn btn-primary mt" onClick={create} disabled={busy}>{busy ? 'Calculating…' : 'Create draft payroll'}</button>
        </div>
      ) : (
        <>
          <div className="grid grid-4 mb">
            <div className="card stat"><div className="label">Total net pay</div><div className="value">{fmtMoney(totals.net)}</div></div>
            <div className="card stat"><div className="label">CPF to pay (employer + employee)</div><div className="value">{fmtMoney(totals.cpfEE + totals.cpfER)}</div></div>
            <div className="card stat"><div className="label">SHG + SDL</div><div className="value">{fmtMoney(totals.shg + totals.sdl)}</div></div>
            <div className="card stat">
              <div className="label">Pay date</div>
              <input type="date" value={run.pay_date ?? ''} onChange={(e) => setPayDate(e.target.value)} disabled={!isDraft} style={{ marginTop: 6 }} />
            </div>
          </div>

          {isDraft && (
            <div className="alert info">
              Draft. Click a row to check or adjust a payslip (OT, bonus, claims, deductions). Click <strong>Recalculate</strong> after changing timesheets, leave or
              employee details; your adjustments are kept. Compare the CPF totals with CPF EZPay before finalising.
            </div>
          )}

          <div className="card">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th className="num">Hours</th>
                    <th className="num">Total wages</th>
                    <th className="num">CPF (ee)</th>
                    <th className="num">CPF (er)</th>
                    <th className="num">SHG</th>
                    <th className="num">Net pay</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {payslips.map((p) => (
                    <tr key={p.id} className="clickable" onClick={() => openEditor(p)}>
                      <td>
                        <strong>{p.result.employee.full_name}</strong>
                        <span className="muted small"> {p.result.employee.employment_type}</span>
                        {p.result.warnings.length > 0 && <span className="badge warn" style={{ marginLeft: 6 }} title={p.result.warnings.join('\n')}>⚠ {p.result.warnings.length}</span>}
                        {(p.overrides.extraEarnings?.length || p.overrides.extraDeductions?.length || p.overrides.otHours != null || p.overrides.unpaidDays != null || p.overrides.disabled?.length)
                          ? <span className="badge info" style={{ marginLeft: 6 }}>adjusted</span> : null}
                      </td>
                      <td className="num">{p.result.hours.worked || '—'}</td>
                      <td className="num">{fmtMoney(p.result.grossWages)}</td>
                      <td className="num">{fmtMoney(p.result.cpf.employee)}</td>
                      <td className="num">{fmtMoney(p.result.cpf.employer)}</td>
                      <td className="num">{p.result.shg ? fmtMoney(p.result.shg) : '—'}</td>
                      <td className="num"><strong>{fmtMoney(p.result.net)}</strong></td>
                      <td className="right nowrap" onClick={(e) => e.stopPropagation()}>
                        <Link className="btn btn-sm" to={`/payslip/${p.id}`}>View</Link>
                        {isDraft && <button className="btn btn-sm btn-ghost btn-danger" onClick={() => removePayslip(p)} title="Remove from run">✕</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Total</td>
                    <td></td>
                    <td className="num">{fmtMoney(totals.gross)}</td>
                    <td className="num">{fmtMoney(totals.cpfEE)}</td>
                    <td className="num">{fmtMoney(totals.cpfER)}</td>
                    <td className="num">{fmtMoney(totals.shg)}</td>
                    <td className="num">{fmtMoney(totals.net)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {isDraft && missing.length > 0 && (
              <div className="row mt">
                <span className="muted small">Not in this run:</span>
                {missing.map((e) => <button key={e.id} className="btn btn-sm" onClick={() => addEmployee(e)}>+ {e.full_name}</button>)}
              </div>
            )}
          </div>
          {isDraft && (
            <div className="mt">
              <button className="btn btn-ghost btn-danger" onClick={removeRun}>Delete this draft</button>
            </div>
          )}
        </>
      )}

      {editing && run && (
        <PayslipEditor
          payslip={editing}
          run={run}
          ctx={ctx}
          company={settings.data?.company}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </>
  );
}

function PayslipEditor({ payslip, run, ctx, company, onClose, onSaved }: {
  payslip: Payslip;
  run: PayrollRun;
  ctx: RunContext | null;
  company?: CompanySettings;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [ov, setOv] = useState<PayrollOverrides>(() => structuredClone(payslip.overrides ?? {}));
  const [error, setError] = useState<string | null>(null);
  const readOnly = run.status !== 'draft';
  const emp = ctx?.employees.find((e) => e.id === payslip.employee_id);
  const result = useMemo(() => (ctx && emp && !readOnly ? calculateFor(ctx, emp, ov) : payslip.result), [ctx, emp, ov, readOnly, payslip.result]);
  // The un-overridden calculation, so HR can see what the system worked out
  const auto = useMemo(() => (ctx && emp ? calculateFor(ctx, emp, { ...ov, otHours: null, unpaidDays: null }) : null), [ctx, emp, ov]);
  const disabled = new Set(ov.disabled ?? []);

  const autoCodes = useMemo(() => {
    if (!ctx || !emp) return [];
    const all = calculateFor(ctx, emp, { ...ov, disabled: [] });
    return [...all.earnings, ...all.deductions].filter((l) => l.auto && !['CPF', 'SHG'].includes(l.code)).map((l) => ({ code: l.code, label: l.label }));
  }, [ctx, emp, ov]);

  const toggle = (code: string) => {
    const d = new Set(disabled);
    if (d.has(code)) d.delete(code);
    else d.add(code);
    setOv({ ...ov, disabled: [...d] });
  };
  const setEarning = (i: number, patch: Partial<ExtraEarning>) =>
    setOv({ ...ov, extraEarnings: (ov.extraEarnings ?? []).map((e, j) => (i === j ? { ...e, ...patch } : e)) });
  const setDeduction = (i: number, patch: Partial<ExtraDeduction>) =>
    setOv({ ...ov, extraDeductions: (ov.extraDeductions ?? []).map((e, j) => (i === j ? { ...e, ...patch } : e)) });

  async function save() {
    if (!emp || !ctx) return;
    try {
      must(await supabase.from('payslips').update(payslipRow(run, emp, ov, calculateFor(ctx, emp, ov))).eq('id', payslip.id));
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Modal
      title={`${payslip.result.employee.full_name}: ${MONTH_NAMES[run.month - 1]} ${run.year}`}
      wide
      onClose={onClose}
      footer={
        readOnly ? (
          <button className="btn" onClick={onClose}>Close</button>
        ) : (
          <>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={save} disabled={!ctx || !emp}>Save payslip</button>
          </>
        )
      }
    >
      {error && <div className="alert error">{error}</div>}
      {result.warnings.length > 0 && (
        <div className="alert warn">
          <ul>{result.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}
      {!readOnly && !emp && ctx && <div className="alert error">This employee no longer exists, so the payslip can't be recalculated.</div>}
      {!readOnly && emp && (
        <div className="stack mb">
          <div className="form-grid">
            <label className="field">
              OT hours <span className="hint">(calculated: {auto?.hours.ot ?? '…'})</span>
              <input type="number" min="0" step="0.25" placeholder="use calculated" value={ov.otHours ?? ''}
                onChange={(e) => setOv({ ...ov, otHours: e.target.value === '' ? null : Number(e.target.value) })} />
            </label>
            <label className="field">
              Unpaid leave days <span className="hint">(from leave: {auto?.unpaidDays ?? '…'})</span>
              <input type="number" min="0" step="0.5" placeholder="use leave records" value={ov.unpaidDays ?? ''}
                onChange={(e) => setOv({ ...ov, unpaidDays: e.target.value === '' ? null : Number(e.target.value) })} />
            </label>
            <div className="field">
              <span>Calculated items</span>
              <div className="row">
                {autoCodes.map((c) => (
                  <label key={c.code} className="check" title="Untick to leave this out, e.g. PH pay when giving a day off in lieu">
                    <input type="checkbox" checked={!disabled.has(c.code)} onChange={() => toggle(c.code)} /> {c.label}
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div>
            <h3>Other earnings</h3>
            <p className="muted small">Ordinary (OW): regular monthly pay like allowances and commission. Additional (AW): bonuses and other irregular pay. No CPF: expense claims and reimbursements.</p>
            {(ov.extraEarnings ?? []).map((e, i) => (
              <div key={i} className="row" style={{ flexWrap: 'nowrap', marginBottom: 6 }}>
                <input placeholder="Description, e.g. Bonus" value={e.label} onChange={(x) => setEarning(i, { label: x.target.value })} />
                <input type="number" step="0.01" style={{ width: 120 }} value={e.amount} onChange={(x) => setEarning(i, { amount: Number(x.target.value) })} />
                <select style={{ width: 150 }} value={e.wageType} onChange={(x) => setEarning(i, { wageType: x.target.value as WageType })}>
                  <option value="OW">Ordinary (OW)</option>
                  <option value="AW">Additional (AW)</option>
                  <option value="NONE">No CPF</option>
                </select>
                <button className="btn btn-ghost btn-sm" onClick={() => setOv({ ...ov, extraEarnings: (ov.extraEarnings ?? []).filter((_, j) => j !== i) })}>✕</button>
              </div>
            ))}
            <button className="btn btn-sm" onClick={() => setOv({ ...ov, extraEarnings: [...(ov.extraEarnings ?? []), { label: '', amount: 0, wageType: 'OW' }] })}>+ Add earning</button>
          </div>

          <div>
            <h3>Other deductions</h3>
            <p className="muted small">Only deductions allowed under the Employment Act (e.g. salary advances, accommodation, agreed amounts).</p>
            {(ov.extraDeductions ?? []).map((d, i) => (
              <div key={i} className="row" style={{ flexWrap: 'nowrap', marginBottom: 6 }}>
                <input placeholder="Description, e.g. Salary advance" value={d.label} onChange={(x) => setDeduction(i, { label: x.target.value })} />
                <input type="number" step="0.01" style={{ width: 120 }} value={d.amount} onChange={(x) => setDeduction(i, { amount: Number(x.target.value) })} />
                <button className="btn btn-ghost btn-sm" onClick={() => setOv({ ...ov, extraDeductions: (ov.extraDeductions ?? []).filter((_, j) => j !== i) })}>✕</button>
              </div>
            ))}
            <button className="btn btn-sm" onClick={() => setOv({ ...ov, extraDeductions: [...(ov.extraDeductions ?? []), { label: '', amount: 0 }] })}>+ Add deduction</button>
          </div>

          <label className="field">
            Remarks on payslip
            <input value={ov.remarks ?? ''} onChange={(e) => setOv({ ...ov, remarks: e.target.value || undefined })} />
          </label>
        </div>
      )}
      <PayslipDoc result={result} company={company ?? { name: 'Mastuya Foods', uen: '', address: '' }} payDate={run.pay_date ?? todayYMD()} draft={!readOnly} />
    </Modal>
  );
}
