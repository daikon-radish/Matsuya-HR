import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { MONTH_NAMES } from '../../lib/dates';
import { fmtMoney, useLoad } from '../../lib/data';
import { must, supabase } from '../../lib/supabase';
import type { Payslip } from '../../lib/types';

export default function MyPayslips() {
  const { employee } = useAuth();
  const slips = useLoad(async () => {
    if (!employee) return [];
    return must(
      await supabase.from('payslips').select('*').eq('employee_id', employee.id).eq('status', 'finalized').order('year', { ascending: false }).order('month', { ascending: false }),
    ) as Payslip[];
  }, [employee?.id]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>My payslips</h1>
          <p>Open a payslip to print it or save it as a PDF.</p>
        </div>
      </div>
      <div className="card">
        {slips.error && <div className="alert error">{slips.error}</div>}
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Month</th><th className="num">Total earnings</th><th className="num">CPF (you)</th><th className="num">Net pay</th><th></th></tr>
            </thead>
            <tbody>
              {(slips.data ?? []).map((p) => (
                <tr key={p.id}>
                  <td>{MONTH_NAMES[p.month - 1]} {p.year}</td>
                  <td className="num">{fmtMoney(p.result.totalEarnings)}</td>
                  <td className="num">{fmtMoney(p.result.cpf.employee)}</td>
                  <td className="num"><strong>{fmtMoney(p.net)}</strong></td>
                  <td className="right"><Link className="btn btn-sm" to={`/payslip/${p.id}`}>View / PDF</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!slips.loading && !slips.data?.length && <div className="empty">No payslips yet.</div>}
        </div>
      </div>
    </>
  );
}
