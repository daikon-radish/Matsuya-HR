import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { formatDate } from '../../lib/dates';
import { employeeColor, fmtMoney, loadEmployees, useLoad } from '../../lib/data';
import { downloadWorkbook } from '../../lib/excel';
import { SHG_LABELS } from '../../lib/payroll/shg';
import type { Employee } from '../../lib/types';

export function payLabel(e: Employee): string {
  return e.employment_type === 'FT' ? `${fmtMoney(e.monthly_basic)}/mth` : `${fmtMoney(e.hourly_rate)}/hr`;
}

export default function Employees() {
  const navigate = useNavigate();
  const [showInactive, setShowInactive] = useState(false);
  const { data, error, loading } = useLoad(() => loadEmployees(), []);
  const list = (data ?? []).filter((e) => showInactive || e.active);

  function exportExcel() {
    const header = ['Code', 'Name', 'Email', 'Phone', 'Type', 'Job title', 'Outlet', 'Monthly basic', 'Hourly rate', 'Fixed allowance', 'OT eligible',
      'Residency', 'PR since', 'SHG fund', 'Date of birth', 'Start date', 'End date', 'Active'];
    const rows = (data ?? []).map((e) => [e.emp_code, e.full_name, e.email, e.phone, e.employment_type, e.job_title, e.outlet, e.monthly_basic, e.hourly_rate,
      e.fixed_allowance, e.ot_eligible ? 'Yes' : 'No', e.residency, e.pr_start_date, SHG_LABELS[e.shg_fund], e.dob, e.start_date, e.end_date, e.active ? 'Yes' : 'No']);
    downloadWorkbook('Matsuya employees.xlsx', [{ name: 'Employees', rows: [header, ...rows], widths: [8, 24, 26, 12, 6, 18, 14, 12, 10, 12, 10, 10, 11, 16, 12, 11, 11, 7] }]);
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Employees</h1>
          <p>Staff records, pay details and logins.</p>
        </div>
        <div className="row">
          <button className="btn" onClick={exportExcel} disabled={!data?.length}>Export to Excel</button>
          <Link className="btn btn-primary" to="/hr/employees/new">Add employee</Link>
        </div>
      </div>
      <div className="card">
        <div className="card-head">
          <h2>{list.length} {showInactive ? 'employees' : 'active employees'}</h2>
          <label className="check">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show former staff
          </label>
        </div>
        {error && <div className="alert error">{error}</div>}
        {loading ? (
          <div className="loading">Loading…</div>
        ) : list.length === 0 ? (
          <div className="empty">No employees yet. Add your first one.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Role / outlet</th>
                  <th className="num">Pay</th>
                  <th>Started</th>
                  <th>Login</th>
                </tr>
              </thead>
              <tbody>
                {list.map((e) => (
                  <tr key={e.id} className="clickable" onClick={() => navigate(`/hr/employees/${e.id}`)}>
                    <td>
                      <span className="dot" style={{ background: employeeColor(e) }} />
                      <strong>{e.full_name}</strong> {e.emp_code && <span className="muted small">{e.emp_code}</span>}
                      {!e.active && <span className="badge" style={{ marginLeft: 6 }}>Former</span>}
                    </td>
                    <td>{e.employment_type === 'FT' ? 'Full-time' : 'Part-time'}</td>
                    <td>{[e.job_title, e.outlet].filter(Boolean).join(' · ') || <span className="muted">—</span>}</td>
                    <td className="num">{payLabel(e)}</td>
                    <td className="nowrap">{formatDate(e.start_date)}</td>
                    <td>{e.user_id ? <span className="badge ok">Active</span> : <span className="badge">None</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
