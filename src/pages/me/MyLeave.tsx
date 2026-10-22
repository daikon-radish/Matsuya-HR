import { useState } from 'react';
import LeaveForm, { openAttachment } from '../../components/LeaveForm';
import { useAuth } from '../../lib/auth';
import { formatDate } from '../../lib/dates';
import { errorMessage, loadHolidays, loadLeaveTypes, useLoad } from '../../lib/data';
import { computeBalances } from '../../lib/leaveBalance';
import { must, supabase } from '../../lib/supabase';
import type { LeaveEntitlement, LeaveRequest } from '../../lib/types';

const STATUS_BADGE: Record<LeaveRequest['status'], string> = { pending: 'warn', approved: 'ok', rejected: 'danger', cancelled: '' };

export default function MyLeave() {
  const { employee } = useAuth();
  const [year, setYear] = useState(new Date().getFullYear());
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const types = useLoad(loadLeaveTypes, []);
  const holidays = useLoad(loadHolidays, []);
  const data = useLoad(async () => {
    if (!employee) return null;
    const [req, ent] = await Promise.all([
      supabase.from('leave_requests').select('*').eq('employee_id', employee.id).order('start_date', { ascending: false }),
      supabase.from('leave_entitlements').select('*').eq('employee_id', employee.id).eq('year', year),
    ]);
    return { requests: must(req) as LeaveRequest[], ent: must(ent) as LeaveEntitlement[] };
  }, [employee?.id, year]);

  if (!employee) return null;
  const balances = data.data ? computeBalances(employee, year, types.data ?? [], data.data.ent, data.data.requests) : [];
  const typeName = (code: string) => types.data?.find((t) => t.code === code)?.name ?? code;
  const list = (data.data?.requests ?? []).filter((r) => r.start_date.startsWith(String(year)));

  async function cancel(r: LeaveRequest) {
    if (!confirm('Cancel this leave request?')) return;
    try {
      must(await supabase.from('leave_requests').update({ status: 'cancelled' }).eq('id', r.id));
      data.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>My leave</h1>
          <p>Apply for leave and upload your MC. HR will approve it here.</p>
        </div>
        <div className="row">
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} style={{ width: 100 }}>
            {[year - 1, year, year + 1].map((y) => <option key={y}>{y}</option>)}
          </select>
          <button className="btn btn-primary" onClick={() => setShowForm(true)}>Apply for leave</button>
        </div>
      </div>
      {error && <div className="alert error">{error}</div>}

      <div className="grid grid-4 mb">
        {balances.map((b) => (
          <div key={b.code} className="card stat">
            <div className="label">{b.name}</div>
            <div className="value">{b.remaining ?? '—'}<span className="muted small"> {b.entitlement != null && `of ${b.entitlement} left`}</span></div>
            {b.pending > 0 && <div className="small muted">{b.pending} pending</div>}
          </div>
        ))}
      </div>

      <div className="card">
        <h2 className="mb">Requests in {year}</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Type</th><th>Dates</th><th className="num">Days</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id}>
                  <td>
                    {typeName(r.leave_type)}
                    {r.reason && <div className="muted small">{r.reason}</div>}
                    {r.hr_note && <div className="small">HR: {r.hr_note}</div>}
                  </td>
                  <td className="nowrap">{formatDate(r.start_date)}{r.end_date !== r.start_date && ` – ${formatDate(r.end_date)}`}{r.half_day && ' (½)'}</td>
                  <td className="num">{Number(r.days)}</td>
                  <td><span className={`badge ${STATUS_BADGE[r.status]}`}>{r.status}</span></td>
                  <td className="right nowrap">
                    {r.attachment_path && <button className="btn btn-ghost btn-sm" onClick={() => openAttachment(r.attachment_path!)}>📎</button>}
                    {r.status === 'pending' && <button className="btn btn-sm" onClick={() => cancel(r)}>Cancel</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!list.length && <div className="empty">No leave requests this year.</div>}
        </div>
      </div>

      {showForm && types.data && (
        <LeaveForm
          employees={[employee]}
          fixedEmployeeId={employee.id}
          types={types.data}
          holidays={holidays.data ?? []}
          balancesFor={() => balances}
          asHR={false}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            data.reload();
          }}
        />
      )}
    </>
  );
}
