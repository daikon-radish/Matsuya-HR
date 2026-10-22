import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import MonthPicker, { currentMonth } from '../../components/MonthPicker';
import { formatDate, MONTH_NAMES } from '../../lib/dates';
import { fmtMoney, useLoad } from '../../lib/data';
import { must, supabase } from '../../lib/supabase';
import type { PayrollRun } from '../../lib/types';

interface RunSummary extends PayrollRun {
  payslips: { net: number; cpf_employer: number; cpf_employee: number }[];
}

export default function Payroll() {
  const navigate = useNavigate();
  const [ym, setYM] = useState(currentMonth());
  const runs = useLoad(
    async () =>
      must(await supabase.from('payroll_runs').select('*, payslips(net, cpf_employer, cpf_employee)').order('year', { ascending: false }).order('month', { ascending: false })) as RunSummary[],
    [],
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Payroll</h1>
          <p>Monthly payslips with CPF, OT and leave worked out from timesheets and leave records.</p>
        </div>
      </div>
      <div className="card mb">
        <div className="row">
          <span>Open payroll for</span>
          <MonthPicker year={ym.year} month={ym.month} onChange={(year, month) => setYM({ year, month })} />
          <button className="btn btn-primary" onClick={() => navigate(`/hr/payroll/${ym.year}/${ym.month}`)}>Open</button>
        </div>
      </div>
      <div className="card">
        <h2 className="mb">Payroll runs</h2>
        {runs.error && <div className="alert error">{runs.error}</div>}
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Month</th>
                <th>Status</th>
                <th className="num">Payslips</th>
                <th className="num">Total net pay</th>
                <th className="num">Total CPF</th>
                <th>Pay date</th>
              </tr>
            </thead>
            <tbody>
              {(runs.data ?? []).map((r) => (
                <tr key={r.id} className="clickable" onClick={() => navigate(`/hr/payroll/${r.year}/${r.month}`)}>
                  <td><Link to={`/hr/payroll/${r.year}/${r.month}`}>{MONTH_NAMES[r.month - 1]} {r.year}</Link></td>
                  <td><span className={`badge ${r.status === 'finalized' ? 'ok' : 'warn'}`}>{r.status === 'finalized' ? 'Finalised' : 'Draft'}</span></td>
                  <td className="num">{r.payslips.length}</td>
                  <td className="num">{fmtMoney(r.payslips.reduce((a, p) => a + Number(p.net), 0))}</td>
                  <td className="num">{fmtMoney(r.payslips.reduce((a, p) => a + Number(p.cpf_employee) + Number(p.cpf_employer), 0))}</td>
                  <td>{formatDate(r.pay_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!runs.loading && !runs.data?.length && <div className="empty">No payroll yet. Pick a month above to start.</div>}
        </div>
      </div>
    </>
  );
}
