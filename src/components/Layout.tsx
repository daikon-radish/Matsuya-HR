import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';

export default function Layout() {
  const { isHR, employee, session, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [pendingLeave, setPendingLeave] = useState(0);
  const location = useLocation();

  useEffect(() => setOpen(false), [location.pathname]);

  useEffect(() => {
    if (!isHR) return;
    supabase
      .from('leave_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .then(({ count }) => setPendingLeave(count ?? 0));
  }, [isHR, location.pathname]);

  return (
    <div className="shell">
      <div className="mobile-bar">
        <div className="brand" style={{ padding: 0 }}>
          <span className="brand-mark">M</span> Matsuya HR
        </div>
        <button className="btn btn-sm" style={{ background: 'transparent', color: '#fff' }} onClick={() => setOpen(true)}>
          Menu
        </button>
      </div>
      <aside className={`sidebar${open ? ' open' : ''}`}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="brand">
            <span className="brand-mark">M</span> Matsuya HR
          </div>
          {open && (
            <button className="btn btn-sm" onClick={() => setOpen(false)}>
              Close
            </button>
          )}
        </div>
        <nav className="nav">
          {isHR && (
            <>
              <div className="nav-section">HR</div>
              <NavLink to="/hr" end>Dashboard</NavLink>
              <NavLink to="/hr/roster">Roster</NavLink>
              <NavLink to="/hr/timesheets">Timesheets</NavLink>
              <NavLink to="/hr/leave">
                Leave {pendingLeave > 0 && <span className="count">{pendingLeave}</span>}
              </NavLink>
              <NavLink to="/hr/payroll">Payroll</NavLink>
              <NavLink to="/hr/employees">Employees</NavLink>
              <NavLink to="/hr/settings">Settings</NavLink>
            </>
          )}
          {employee && (
            <>
              <div className="nav-section">{isHR ? 'Me' : 'Menu'}</div>
              <NavLink to="/me" end>Home</NavLink>
              <NavLink to="/me/shifts">My shifts</NavLink>
              <NavLink to="/me/availability">My availability</NavLink>
              <NavLink to="/me/leave">My leave</NavLink>
              <NavLink to="/me/payslips">My payslips</NavLink>
            </>
          )}
          <div className="nav-section">Account</div>
          <NavLink to="/account/password">Change password</NavLink>
        </nav>
        <div className="sidebar-footer">
          <div className="who">{employee?.full_name ?? session?.user.email}</div>
          <div>{isHR ? 'HR' : 'Employee'}</div>
          <button className="btn btn-sm" onClick={signOut}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
