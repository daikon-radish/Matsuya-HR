import AvailabilityEditor from '../../components/AvailabilityEditor';
import { useAuth } from '../../lib/auth';

export default function MyAvailability() {
  const { employee } = useAuth();
  if (!employee) return null;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>My availability</h1>
          <p>Let HR know when you can work.</p>
        </div>
      </div>
      <div className="card">
        <AvailabilityEditor employeeId={employee.id} />
      </div>
    </>
  );
}
