import { useMemo, useState } from 'react';
import LeaveForm, { openAttachment } from '../../components/LeaveForm';
import { formatDate } from '../../lib/dates';
import { errorMessage, loadEmployees, loadHolidays, loadLeaveTypes, useLoad } from '../../lib/data';
import { downloadWorkbook } from '../../lib/excel';
import { computeBalances } from '../../lib/leaveBalance';
import { must, supabase } from '../../lib/supabase';
import type { LeaveEntitlement, LeaveRequest } from '../../lib/types';

const STATUS_BADGE: Record<LeaveRequest['status'], string> = { pending: 'warn', approved: 'ok', rejected: 'danger', cancelled: '' };

export default function LeaveAdmin() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [tab, setTab] = useState<'pending' | 'all' | 'balances'>('pending');
  const [filter, setFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const employees = useLoad(() => loadEmployees(), []);
  const types = useLoad(loadLeaveTypes, []);
  const holidays = useLoad(loadHolidays, []);
  const requests = useLoad(
    async () =>
      must(await supabase.from('leave_requests').select('*').or(`status.eq.pending,and(start_date.gte.${year}-01-01,start_date.lte.${year}-12-31)`).order('start_date', { ascending: false })) as LeaveRequest[],
    [year],
  );
  const entitlements = useLoad(async () => must(await supabase.from('leave_entitlements').select('*').eq('year', year)) as LeaveEntitlement[], [year]);

  const empList = employees.data ?? [];
  const byId = useMemo(() => new Map(empList.map((e) => [e.id, e])), [empList]);
  const typeName = (code: string) => types.data?.find((t) => t.code === code)?.name ?? code;
  const all = requests.data ?? [];
  const pending = all.filter((r) => r.status === 'pending');
  const shown = (tab === 'pending' ? pending : all.filter((r) => r.start_date.startsWith(String(year)))).filter((r) => !filter || r.employee_id === filter);

  const balancesFor = (id: string) => {
    const e = byId.get(id);
    return e ? computeBalances(e, year, types.data ?? [], entitlements.data ?? [], all) : [];
  };
  const tracked = (types.data ?? []).filter((t) => t.track_balance);

  async function decide(r: LeaveRequest, status: 'approved' | 'rejected' | 'cancelled') {
    const note = status === 'rejected' ? prompt('Reason for rejecting (optional, the employee will see it):') : null;
    if (status === 'rejected' && note === null) return;
    try {
      must(await supabase.from('leave_requests').update({ status, hr_note: note || r.hr_note }).eq('id', r.id));
      requests.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function remove(r: LeaveRequest) {
    if (!confirm('Delete this leave record permanently?')) return;
    try {
      if (r.attachment_path) await supabase.storage.from('leave-attachments').remove([r.attachment_path]);
      must(await supabase.from('leave_requests').delete().eq('id', r.id));
      requests.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function exportExcel() {
    const reqRows = all
      .filter((r) => r.start_date.startsWith(String(year)))
      .map((r) => [byId.get(r.employee_id)?.full_name ?? '', typeName(r.leave_type), r.start_date, r.end_date, Number(r.days), r.status, r.reason ?? '', r.hr_note ?? '']);
    const balRows = empList.filter((e) => e.active).map((e) => {
      const b = balancesFor(e.id);
      return [e.full_name, ...tracked.flatMap((t) => {
        const x = b.find((y) => y.code === t.code);
        return [x?.entitlement ?? '', x?.used ?? 0, x?.remaining ?? ''];
      })];
    });
    downloadWorkbook(`Leave ${year}.xlsx`, [
      { name: 'Balances', rows: [['Employee', ...tracked.flatMap((t) => [`${t.code} entitled`, `${t.code} used`, `${t.code} left`])], ...balRows], widths: [24, ...tracked.flatMap(() => [11, 9, 9])] },
      { name: 'Requests', rows: [['Employee', 'Type', 'From', 'To', 'Days', 'Status', 'Reason', 'HR note'], ...reqRows], widths: [24, 22, 11, 11, 6, 10, 30, 30] },
    ]);
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Leave</h1>
          <p>Approve requests, record MC and leave, and track balances.</p>
        </div>
        <div className="row">
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} style={{ width: 100 }}>
            {[year - 1, year, year + 1].map((y) => <option key={y}>{y}</option>)}
          </select>
          <button className="btn" onClick={exportExcel}>Export to Excel</button>
          <button className="btn btn-primary" onClick={() => setShowForm(true)}>Record leave</button>
        </div>
      </div>
      {error && <div className="alert error">{error}</div>}
      <div className="tabs">
        <button className={tab === 'pending' ? 'active' : ''} onClick={() => setTab('pending')}>Pending ({pending.length})</button>
        <button className={tab === 'all' ? 'active' : ''} onClick={() => setTab('all')}>All requests</button>
        <button className={tab === 'balances' ? 'active' : ''} onClick={() => setTab('balances')}>Balances</button>
      </div>

      {tab !== 'balances' ? (
        <div className="card">
          <div className="card-head">
            <h2>{tab === 'pending' ? 'Waiting for approval' : `${year} requests`}</h2>
            <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 220 }}>
              <option value="">All employees</option>
              {empList.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Employee</th><th>Type</th><th>Dates</th><th className="num">Days</th><th>Reason</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const bal = r.status === 'pending' ? balancesFor(r.employee_id).find((b) => b.code === r.leave_type) : undefined;
                  return (
                    <tr key={r.id}>
                      <td>{byId.get(r.employee_id)?.full_name}</td>
                      <td>{typeName(r.leave_type)}</td>
                      <td className="nowrap">{formatDate(r.start_date)}{r.end_date !== r.start_date && ` – ${formatDate(r.end_date)}`}{r.half_day && ' (½)'}</td>
                      <td className="num">
                        {Number(r.days)}
                        {bal?.remaining != null && <div className={`small ${bal.remaining - Number(r.days) < 0 ? '' : 'muted'}`} style={bal.remaining - Number(r.days) < 0 ? { color: 'var(--danger)' } : {}}>{bal.remaining} left</div>}
                      </td>
                      <td>
                        {r.reason}
                        {r.attachment_path && <div><button className="btn btn-ghost btn-sm" style={{ paddingLeft: 0 }} onClick={() => openAttachment(r.attachment_path!)}>📎 View attachment</button></div>}
                        {r.hr_note && <div className="muted small">HR: {r.hr_note}</div>}
                      </td>
                      <td><span className={`badge ${STATUS_BADGE[r.status]}`}>{r.status}</span></td>
                      <td className="right nowrap">
                        {r.status === 'pending' && (
                          <>
                            <button className="btn btn-sm btn-primary" onClick={() => decide(r, 'approved')}>Approve</button>{' '}
                            <button className="btn btn-sm" onClick={() => decide(r, 'rejected')}>Reject</button>
                          </>
                        )}
                        {r.status === 'approved' && <button className="btn btn-sm" onClick={() => decide(r, 'cancelled')}>Cancel</button>}{' '}
                        <button className="btn btn-sm btn-ghost btn-danger" onClick={() => remove(r)} title="Delete">✕</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!shown.length && <div className="empty">{tab === 'pending' ? 'Nothing waiting. 🎉' : 'No leave this year.'}</div>}
          </div>
        </div>
      ) : (
        <div className="card">
          <p className="muted small">Days left = entitlement − approved leave in {year}. Hospitalisation includes outpatient sick leave, as under the Employment Act. Set custom entitlements on each employee's page.</p>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Employee</th>
                  {tracked.map((t) => <th key={t.code} className="num">{t.name}</th>)}
                </tr>
              </thead>
              <tbody>
                {empList.filter((e) => e.active).map((e) => {
                  const b = balancesFor(e.id);
                  return (
                    <tr key={e.id}>
                      <td>{e.full_name}</td>
                      {tracked.map((t) => {
                        const x = b.find((y) => y.code === t.code);
                        return (
                          <td key={t.code} className="num">
                            {x?.entitlement == null ? '—' : <><strong>{x.remaining}</strong><span className="muted"> / {x.entitlement}</span></>}
                            {x?.pending ? <div className="small muted">{x.pending} pending</div> : null}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showForm && types.data && (
        <LeaveForm
          employees={empList}
          types={types.data}
          holidays={holidays.data ?? []}
          balancesFor={balancesFor}
          asHR
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            requests.reload();
          }}
        />
      )}
    </>
  );
}
