import { Link } from 'react-router-dom';
import { addDays, formatDate, MONTH_NAMES, todayYMD, WEEKDAY_SHORT, weekday } from '../../lib/dates';
import { employeeColor, hhmm, loadEmployees, loadHolidays, useLoad } from '../../lib/data';
import { must, supabase } from '../../lib/supabase';
import type { LeaveRequest, PayrollRun, Shift } from '../../lib/types';

export default function Dashboard() {
  const today = todayYMD();
  const now = new Date();
  const lastMonth = now.getMonth() === 0 ? { year: now.getFullYear() - 1, month: 12 } : { year: now.getFullYear(), month: now.getMonth() };
  const employees = useLoad(() => loadEmployees(true), []);
  const holidays = useLoad(loadHolidays, []);
  const data = useLoad(async () => {
    const [shifts, leave, pending, runs] = await Promise.all([
      supabase.from('shifts').select('*').gte('date', today).lte('date', addDays(today, 6)).order('date').order('start_time'),
      supabase.from('leave_requests').select('*').eq('status', 'approved').lte('start_date', addDays(today, 6)).gte('end_date', today),
      supabase.from('leave_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('payroll_runs').select('*').order('year', { ascending: false }).order('month', { ascending: false }).limit(3),
    ]);
    return {
      shifts: must(shifts) as Shift[],
      leave: must(leave) as LeaveRequest[],
      pending: pending.count ?? 0,
      runs: must(runs) as PayrollRun[],
    };
  }, [today]);

  const byId = new Map((employees.data ?? []).map((e) => [e.id, e]));
  const todayShifts = (data.data?.shifts ?? []).filter((s) => s.date === today && s.status !== 'absent');
  const onLeaveToday = (data.data?.leave ?? []).filter((l) => l.start_date <= today && l.end_date >= today);
  const upcomingHolidays = (holidays.data ?? []).filter((h) => h.date >= today).slice(0, 3);
  const lastRun = data.data?.runs.find((r) => r.year === lastMonth.year && r.month === lastMonth.month);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p>{WEEKDAY_SHORT[weekday(today)]} {formatDate(today)}</p>
        </div>
      </div>
      {data.error && <div className="alert error">{data.error}</div>}

      <div className="grid grid-4 mb">
        <div className="card stat">
          <div className="label">Active staff</div>
          <div className="value">{employees.data?.length ?? '…'}</div>
          <Link to="/hr/employees">Manage</Link>
        </div>
        <div className="card stat">
          <div className="label">Leave waiting for approval</div>
          <div className="value">{data.data?.pending ?? '…'}</div>
          <Link to="/hr/leave">Review</Link>
        </div>
        <div className="card stat">
          <div className="label">Working today</div>
          <div className="value">{new Set(todayShifts.map((s) => s.employee_id)).size}</div>
          <Link to="/hr/roster">Roster</Link>
        </div>
        <div className="card stat">
          <div className="label">{MONTH_NAMES[lastMonth.month - 1]} payroll</div>
          <div className="value" style={{ fontSize: 18, marginTop: 8 }}>
            {lastRun ? (lastRun.status === 'finalized' ? <span className="badge ok">Finalised</span> : <span className="badge warn">Draft</span>) : <span className="badge">Not started</span>}
          </div>
          <Link to={`/hr/payroll/${lastMonth.year}/${lastMonth.month}`}>Open</Link>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <h2 className="mb">Next 7 days</h2>
          {(data.data?.shifts ?? []).length === 0 ? (
            <div className="empty">No shifts rostered. <Link to="/hr/roster">Open the roster</Link></div>
          ) : (
            <table className="table">
              <tbody>
                {(data.data?.shifts ?? []).map((s) => {
                  const e = byId.get(s.employee_id);
                  return (
                    <tr key={s.id}>
                      <td className="nowrap">{s.date === today ? <strong>Today</strong> : `${WEEKDAY_SHORT[weekday(s.date)]} ${formatDate(s.date)}`}</td>
                      <td>{e && <span className="dot" style={{ background: employeeColor(e) }} />}{e?.full_name}</td>
                      <td className="nowrap right">{hhmm(s.start_time)}–{hhmm(s.end_time)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <div className="stack">
          <div className="card">
            <h2 className="mb">On leave</h2>
            {(data.data?.leave ?? []).length === 0 ? (
              <div className="muted">Nobody on leave this week.</div>
            ) : (
              <table className="table">
                <tbody>
                  {(data.data?.leave ?? []).map((l) => (
                    <tr key={l.id}>
                      <td>{byId.get(l.employee_id)?.full_name}</td>
                      <td>{l.leave_type}</td>
                      <td className="nowrap right">
                        {formatDate(l.start_date)}{l.end_date !== l.start_date && ` – ${formatDate(l.end_date)}`}
                        {onLeaveToday.includes(l) && <span className="badge info" style={{ marginLeft: 6 }}>today</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="card">
            <h2 className="mb">Upcoming public holidays</h2>
            {upcomingHolidays.map((h) => (
              <div key={h.date} className="row" style={{ justifyContent: 'space-between', padding: '4px 0' }}>
                <span>{h.name}</span>
                <span className="muted">{WEEKDAY_SHORT[weekday(h.date)]} {formatDate(h.date)}</span>
              </div>
            ))}
            {!upcomingHolidays.length && <div className="muted">None entered. Add them in Settings.</div>}
          </div>
        </div>
      </div>
    </>
  );
}
