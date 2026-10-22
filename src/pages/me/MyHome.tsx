import { Link } from 'react-router-dom';
import { addDays, formatDate, MONTH_NAMES, todayYMD, WEEKDAY_SHORT, weekday } from '../../lib/dates';
import { fmtMoney, hhmm, loadLeaveTypes, useLoad } from '../../lib/data';
import { useAuth } from '../../lib/auth';
import { computeBalances } from '../../lib/leaveBalance';
import { must, supabase } from '../../lib/supabase';
import type { LeaveEntitlement, LeaveRequest, Payslip, Shift } from '../../lib/types';

export default function MyHome() {
  const { employee } = useAuth();
  const today = todayYMD();
  const year = Number(today.slice(0, 4));
  const types = useLoad(loadLeaveTypes, []);
  const data = useLoad(async () => {
    if (!employee) return null;
    const [shifts, leave, ent, slip] = await Promise.all([
      supabase.from('shifts').select('*').eq('employee_id', employee.id).gte('date', today).lte('date', addDays(today, 13)).neq('status', 'absent').order('date').order('start_time'),
      supabase.from('leave_requests').select('*').eq('employee_id', employee.id).gte('start_date', `${year}-01-01`),
      supabase.from('leave_entitlements').select('*').eq('employee_id', employee.id).eq('year', year),
      supabase.from('payslips').select('*').eq('employee_id', employee.id).eq('status', 'finalized').order('year', { ascending: false }).order('month', { ascending: false }).limit(1),
    ]);
    return {
      shifts: must(shifts) as Shift[],
      leave: must(leave) as LeaveRequest[],
      ent: must(ent) as LeaveEntitlement[],
      slip: (must(slip) as Payslip[])[0],
    };
  }, [employee?.id, today]);

  if (!employee) return <div className="card">Your login isn't linked to an employee record. Please ask HR.</div>;
  const balances = data.data ? computeBalances(employee, year, types.data ?? [], data.data.ent, data.data.leave) : [];
  const pending = (data.data?.leave ?? []).filter((l) => l.status === 'pending').length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Hi, {employee.full_name.split(' ')[0]}</h1>
          <p>{WEEKDAY_SHORT[weekday(today)]} {formatDate(today)}</p>
        </div>
        <div className="row">
          <Link className="btn" to="/me/availability">Update availability</Link>
          <Link className="btn btn-primary" to="/me/leave">Apply for leave</Link>
        </div>
      </div>
      {data.error && <div className="alert error">{data.error}</div>}

      <div className="grid grid-2">
        <div className="card">
          <div className="card-head">
            <h2>Upcoming shifts</h2>
            <Link to="/me/shifts" className="small">See all</Link>
          </div>
          {(data.data?.shifts ?? []).length === 0 ? (
            <div className="muted">No shifts in the next two weeks.</div>
          ) : (
            <table className="table">
              <tbody>
                {data.data!.shifts.map((s) => (
                  <tr key={s.id}>
                    <td>{s.date === today ? <strong>Today</strong> : `${WEEKDAY_SHORT[weekday(s.date)]} ${formatDate(s.date)}`}</td>
                    <td className="right nowrap">{hhmm(s.start_time)}–{hhmm(s.end_time)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="stack">
          <div className="card">
            <div className="card-head">
              <h2>Leave left in {year}</h2>
              {pending > 0 && <span className="badge warn">{pending} pending</span>}
            </div>
            <div className="grid grid-2">
              {balances.filter((b) => b.entitlement).map((b) => (
                <div key={b.code}>
                  <div className="muted small">{b.name}</div>
                  <div style={{ fontSize: 20, fontWeight: 650 }}>{b.remaining} <span className="muted small">of {b.entitlement}</span></div>
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <div className="card-head">
              <h2>Latest payslip</h2>
              <Link to="/me/payslips" className="small">All payslips</Link>
            </div>
            {data.data?.slip ? (
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span>{MONTH_NAMES[data.data.slip.month - 1]} {data.data.slip.year}: <strong>{fmtMoney(data.data.slip.net)}</strong></span>
                <Link className="btn btn-sm" to={`/payslip/${data.data.slip.id}`}>View</Link>
              </div>
            ) : (
              <div className="muted">No payslips yet.</div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
