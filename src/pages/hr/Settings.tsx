import { useEffect, useState } from 'react';
import { formatDate, WEEKDAY_SHORT, weekday } from '../../lib/dates';
import { errorMessage, loadHolidays, loadLeaveTypes, loadSettings, useLoad } from '../../lib/data';
import { downloadWorkbook, type Cell } from '../../lib/excel';
import { must, supabase } from '../../lib/supabase';
import type { CompanySettings, LeaveType, PayrollSettings } from '../../lib/types';

export default function Settings() {
  const settings = useLoad(loadSettings, []);
  const [company, setCompany] = useState<CompanySettings | null>(null);
  const [payroll, setPayroll] = useState<PayrollSettings | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (settings.data) {
      setCompany(settings.data.company);
      setPayroll(settings.data.payroll);
    }
  }, [settings.data]);

  async function saveSettings() {
    try {
      must(await supabase.from('settings').upsert([{ key: 'company', value: company }, { key: 'payroll', value: payroll }]));
      setMsg({ ok: true, text: 'Settings saved' });
    } catch (err) {
      setMsg({ ok: false, text: errorMessage(err) });
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>Company details, overtime rules, public holidays and leave types.</p>
        </div>
        <BackupButton />
      </div>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`}>{msg.text}</div>}

      {company && payroll && (
        <div className="grid grid-2">
          <div className="card stack">
            <h2>Company (shown on payslips)</h2>
            <label className="field">
              Company name
              <input value={company.name} onChange={(e) => setCompany({ ...company, name: e.target.value })} />
            </label>
            <label className="field">
              UEN
              <input value={company.uen} onChange={(e) => setCompany({ ...company, uen: e.target.value })} />
            </label>
            <label className="field">
              Address
              <textarea value={company.address} onChange={(e) => setCompany({ ...company, address: e.target.value })} />
            </label>
          </div>
          <div className="card stack">
            <h2>Payroll rules</h2>
            <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <label className="field">
                OT rate (× hourly basic)
                <input type="number" step="0.1" min="1" value={payroll.ot_multiplier} onChange={(e) => setPayroll({ ...payroll, ot_multiplier: Number(e.target.value) })} />
              </label>
              <label className="field">
                Pay day <span className="hint">(day of next month, max 7)</span>
                <input type="number" min="1" max="7" value={payroll.pay_day} onChange={(e) => setPayroll({ ...payroll, pay_day: Number(e.target.value) })} />
              </label>
              <label className="field">
                OT after hours per day
                <input type="number" step="0.5" value={payroll.ot_daily_threshold} onChange={(e) => setPayroll({ ...payroll, ot_daily_threshold: Number(e.target.value) })} />
              </label>
              <label className="field">
                OT after hours per week
                <input type="number" step="0.5" value={payroll.ot_weekly_threshold} onChange={(e) => setPayroll({ ...payroll, ot_weekly_threshold: Number(e.target.value) })} />
              </label>
            </div>
            <p className="muted small">
              Employment Act defaults: OT at 1.5× for hours beyond 9 a day or 44 a week, salary paid within 7 days of the month end.
              CPF rates and ceilings are built in (2026 tables) and are updated in the code each January.
            </p>
          </div>
        </div>
      )}
      <div className="row mt mb">
        <button className="btn btn-primary" onClick={saveSettings} disabled={!company}>Save settings</button>
      </div>

      <div className="grid grid-2">
        <HolidaysCard />
        <LeaveTypesCard />
      </div>
    </>
  );
}

function HolidaysCard() {
  const [year, setYear] = useState(new Date().getFullYear());
  const holidays = useLoad(loadHolidays, []);
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const list = (holidays.data ?? []).filter((h) => h.date.startsWith(String(year)));

  async function add() {
    if (!date || !name) return;
    try {
      must(await supabase.from('holidays').upsert({ date, name }));
      setDate('');
      setName('');
      holidays.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  async function remove(d: string) {
    try {
      must(await supabase.from('holidays').delete().eq('date', d));
      holidays.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2>Public holidays</h2>
        <select value={year} onChange={(e) => setYear(Number(e.target.value))} style={{ width: 100 }}>
          {[year - 1, year, year + 1].map((y) => <option key={y}>{y}</option>)}
        </select>
      </div>
      <p className="muted small">MOM publishes next year's list around June. When a holiday falls on a Sunday, add the Monday in lieu too.</p>
      {error && <div className="alert error">{error}</div>}
      <table className="table">
        <tbody>
          {list.map((h) => (
            <tr key={h.date}>
              <td className="nowrap">{WEEKDAY_SHORT[weekday(h.date)]} {formatDate(h.date)}</td>
              <td>{h.name}</td>
              <td className="right"><button className="btn btn-ghost btn-sm" onClick={() => remove(h.date)}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {!list.length && <div className="empty">No holidays entered for {year}.</div>}
      <div className="row mt" style={{ flexWrap: 'nowrap' }}>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 160 }} />
        <input placeholder="Holiday name" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn" onClick={add}>Add</button>
      </div>
    </div>
  );
}

function LeaveTypesCard() {
  const types = useLoad(loadLeaveTypes, []);
  const [rows, setRows] = useState<LeaveType[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => setRows(types.data ?? []), [types.data]);

  const set = (i: number, patch: Partial<LeaveType>) => setRows(rows.map((r, j) => (i === j ? { ...r, ...patch } : r)));
  const statutory = (code: string) => ['AL', 'MC', 'HOSP'].includes(code);

  async function save() {
    try {
      const clean = rows.filter((r) => r.code.trim() && r.name.trim()).map((r, i) => ({ ...r, code: r.code.trim().toUpperCase(), sort_order: i + 1 }));
      must(await supabase.from('leave_types').upsert(clean));
      setMsg('Saved');
      types.reload();
    } catch (err) {
      setMsg(errorMessage(err));
    }
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2>Leave types</h2>
        {msg && <span className={`badge ${msg === 'Saved' ? 'ok' : 'danger'}`}>{msg}</span>}
      </div>
      <p className="muted small">Annual, sick and hospitalisation leave default to Employment Act entitlements. For other types, "Days" is the yearly default for everyone.</p>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>Code</th><th>Name</th><th>Paid</th><th>Track balance</th><th>Days</th></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td style={{ width: 110 }}>
                  <input value={r.code} disabled={Boolean(types.data?.some((t) => t.code === r.code))} onChange={(e) => set(i, { code: e.target.value })} />
                </td>
                <td><input value={r.name} onChange={(e) => set(i, { name: e.target.value })} /></td>
                <td><input type="checkbox" checked={r.paid} onChange={(e) => set(i, { paid: e.target.checked })} /></td>
                <td><input type="checkbox" checked={r.track_balance} onChange={(e) => set(i, { track_balance: e.target.checked })} /></td>
                <td style={{ width: 90 }}>
                  {statutory(r.code) ? <span className="muted small">by law</span> : (
                    <input type="number" min="0" step="0.5" value={r.default_days ?? ''} onChange={(e) => set(i, { default_days: e.target.value === '' ? null : Number(e.target.value) })} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row mt">
        <button className="btn" onClick={() => setRows([...rows, { code: '', name: '', paid: true, track_balance: true, default_days: 0, sort_order: rows.length + 1 }])}>+ Add type</button>
        <button className="btn btn-primary" onClick={save}>Save leave types</button>
      </div>
    </div>
  );
}

const BACKUP_TABLES = ['employees', 'shifts', 'availability', 'leave_requests', 'leave_entitlements', 'leave_types', 'holidays', 'payroll_runs', 'payslips', 'settings'];

function BackupButton() {
  const [busy, setBusy] = useState(false);
  async function backup() {
    setBusy(true);
    try {
      const sheets = [];
      for (const t of BACKUP_TABLES) {
        const rows = must(await supabase.from(t).select('*')) as Record<string, unknown>[];
        const cols = rows.length ? Object.keys(rows[0]) : ['(empty)'];
        const cell = (v: unknown): Cell => (v == null ? null : typeof v === 'object' ? JSON.stringify(v) : (v as Cell));
        sheets.push({ name: t, rows: [cols, ...rows.map((r) => cols.map((c) => cell(r[c])))] });
      }
      const stamp = new Date().toISOString().slice(0, 10);
      downloadWorkbook(`Mastuya HR backup ${stamp}.xlsx`, sheets);
    } catch (err) {
      alert(errorMessage(err));
    }
    setBusy(false);
  }
  return (
    <button className="btn" onClick={backup} disabled={busy} title="Download every table as one Excel file. Do this monthly and keep it somewhere safe.">
      {busy ? 'Exporting…' : 'Download full backup'}
    </button>
  );
}
