import type { ReactNode } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import { AuthProvider, useAuth } from './lib/auth';
import { isConfigured } from './lib/supabase';
import ChangePassword from './pages/ChangePassword';
import Login from './pages/Login';
import PayslipPage from './pages/PayslipPage';
import Dashboard from './pages/hr/Dashboard';
import EmployeeEdit from './pages/hr/EmployeeEdit';
import Employees from './pages/hr/Employees';
import LeaveAdmin from './pages/hr/LeaveAdmin';
import Payroll from './pages/hr/Payroll';
import PayrollRunPage from './pages/hr/PayrollRun';
import Roster from './pages/hr/Roster';
import Settings from './pages/hr/Settings';
import Timesheets from './pages/hr/Timesheets';
import MyAvailability from './pages/me/MyAvailability';
import MyHome from './pages/me/MyHome';
import MyLeave from './pages/me/MyLeave';
import MyPayslips from './pages/me/MyPayslips';
import MyShifts from './pages/me/MyShifts';

function NotConfigured() {
  return (
    <div className="auth-page">
      <div className="card auth-card">
        <h2>Almost there</h2>
        <p className="muted mt">
          The app isn't connected to Supabase yet. Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> (see README.md).
        </p>
      </div>
    </div>
  );
}

function Gate({ children }: { children: ReactNode }) {
  const { loading, session, profile } = useAuth();
  if (loading) return <div className="auth-page loading">Loading…</div>;
  if (!session) return <Login />;
  if (!profile) {
    return (
      <div className="auth-page">
        <div className="card auth-card">
          <p>Your account has no profile yet. Ask HR to check it, or run supabase/schema.sql again.</p>
        </div>
      </div>
    );
  }
  if (profile.must_change_password) return <ChangePassword forced />;
  return <>{children}</>;
}

function HROnly({ children }: { children: ReactNode }) {
  const { isHR } = useAuth();
  return isHR ? <>{children}</> : <Navigate to="/me" replace />;
}

function Home() {
  const { isHR, employee } = useAuth();
  if (isHR) return <Navigate to="/hr" replace />;
  if (employee) return <Navigate to="/me" replace />;
  return (
    <div className="card">
      <h2>No employee record</h2>
      <p className="muted mt">Your login isn't linked to an employee record yet. Please ask HR to link it.</p>
    </div>
  );
}

export default function App() {
  if (!isConfigured) return <NotConfigured />;
  return (
    <AuthProvider>
      <HashRouter>
        <Gate>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Home />} />
              <Route path="hr" element={<HROnly><Dashboard /></HROnly>} />
              <Route path="hr/roster" element={<HROnly><Roster /></HROnly>} />
              <Route path="hr/timesheets" element={<HROnly><Timesheets /></HROnly>} />
              <Route path="hr/leave" element={<HROnly><LeaveAdmin /></HROnly>} />
              <Route path="hr/payroll" element={<HROnly><Payroll /></HROnly>} />
              <Route path="hr/payroll/:year/:month" element={<HROnly><PayrollRunPage /></HROnly>} />
              <Route path="hr/employees" element={<HROnly><Employees /></HROnly>} />
              <Route path="hr/employees/:id" element={<HROnly><EmployeeEdit /></HROnly>} />
              <Route path="hr/settings" element={<HROnly><Settings /></HROnly>} />
              <Route path="me" element={<MyHome />} />
              <Route path="me/shifts" element={<MyShifts />} />
              <Route path="me/availability" element={<MyAvailability />} />
              <Route path="me/leave" element={<MyLeave />} />
              <Route path="me/payslips" element={<MyPayslips />} />
              <Route path="payslip/:id" element={<PayslipPage />} />
              <Route path="payslips/run/:runId" element={<HROnly><PayslipPage /></HROnly>} />
              <Route path="account/password" element={<ChangePassword />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </Gate>
      </HashRouter>
    </AuthProvider>
  );
}
