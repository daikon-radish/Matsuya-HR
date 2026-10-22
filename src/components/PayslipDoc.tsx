import { formatDate, MONTH_NAMES } from '../lib/dates';
import { fmtMoney } from '../lib/data';
import { AGE_BAND_LABELS, SCHEME_LABELS } from '../lib/payroll/cpf';
import type { PayslipResult } from '../lib/payroll/pay';
import type { CompanySettings } from '../lib/types';

interface Props {
  result: PayslipResult;
  company: CompanySettings;
  payDate: string | null;
  draft?: boolean;
}

/** Itemised payslip with everything MOM requires (Employment Act s.96). */
export default function PayslipDoc({ result: r, company, payDate, draft }: Props) {
  const otLine = r.earnings.find((e) => e.code === 'OT');
  return (
    <article className="payslip">
      <div className="ps-head">
        <div>
          <div className="ps-company">{company.name}</div>
          {company.uen && <div>UEN {company.uen}</div>}
          {company.address && <div style={{ whiteSpace: 'pre-line' }}>{company.address}</div>}
        </div>
        <div className="ps-title">
          <div className="t">PAYSLIP{draft ? ' (DRAFT)' : ''}</div>
          <div>{MONTH_NAMES[r.month - 1]} {r.year}</div>
        </div>
      </div>

      <div className="ps-info">
        <div><span>Employee</span><strong>{r.employee.full_name}</strong></div>
        <div><span>Salary period</span><span>{formatDate(r.periodStart)} – {formatDate(r.periodEnd)}</span></div>
        <div><span>Employee code</span><span>{r.employee.emp_code ?? '—'}</span></div>
        <div><span>Date of payment</span><span>{payDate ? formatDate(payDate) : '—'}</span></div>
        <div><span>NRIC/FIN</span><span>{r.employee.nric_last4 ? `•••••${r.employee.nric_last4}` : '—'}</span></div>
        <div><span>Employment</span><span>{r.employee.employment_type === 'FT' ? 'Full-time' : 'Part-time'}{r.employee.job_title ? ` · ${r.employee.job_title}` : ''}</span></div>
      </div>

      <div className="ps-cols">
        <table>
          <thead><tr><th>Earnings</th><th className="amt">Amount</th></tr></thead>
          <tbody>
            {r.earnings.map((e) => (
              <tr key={e.code}>
                <td>
                  {e.label}
                  {e.wageType === 'AW' && <span className="detail">Additional wage</span>}
                  {e.wageType === 'NONE' && <span className="detail">Not subject to CPF</span>}
                  {e.detail && <span className="detail">{e.detail}</span>}
                </td>
                <td className="amt">{fmtMoney(e.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td>Total earnings</td><td className="amt">{fmtMoney(r.totalEarnings)}</td></tr></tfoot>
        </table>
        <table>
          <thead><tr><th>Deductions</th><th className="amt">Amount</th></tr></thead>
          <tbody>
            {r.deductions.map((d) => (
              <tr key={d.code}>
                <td>
                  {d.label}
                  {d.detail && <span className="detail">{d.detail}</span>}
                </td>
                <td className="amt">{fmtMoney(d.amount)}</td>
              </tr>
            ))}
            {!r.deductions.length && <tr><td className="detail">None</td><td></td></tr>}
          </tbody>
          <tfoot><tr><td>Total deductions</td><td className="amt">{fmtMoney(r.totalDeductions)}</td></tr></tfoot>
        </table>
      </div>

      <div className="ps-net">
        <span>Net pay</span>
        <span>{fmtMoney(r.net)}</span>
      </div>

      <div className="ps-foot">
        <table>
          <thead><tr><th>Overtime</th><th className="amt"></th></tr></thead>
          <tbody>
            <tr><td>Overtime hours</td><td className="amt">{r.hours.ot}</td></tr>
            <tr><td>Overtime pay</td><td className="amt">{fmtMoney(otLine?.amount ?? 0)}</td></tr>
            <tr><td>Overtime period</td><td className="amt">{formatDate(r.periodStart)} – {formatDate(r.periodEnd)}</td></tr>
            {r.hours.worked > 0 && <tr><td>Hours worked</td><td className="amt">{r.hours.worked}</td></tr>}
          </tbody>
        </table>
        <table>
          <thead><tr><th>For your information</th><th className="amt"></th></tr></thead>
          <tbody>
            <tr><td>Employer CPF contribution</td><td className="amt">{fmtMoney(r.cpf.employer)}</td></tr>
            <tr><td>Total CPF (employer + employee)</td><td className="amt">{fmtMoney(r.cpf.total)}</td></tr>
            {r.cpf.scheme && <tr><td>CPF rates</td><td className="amt">{SCHEME_LABELS[r.cpf.scheme]}, {r.cpf.ageBand && AGE_BAND_LABELS[r.cpf.ageBand]}</td></tr>}
            {r.paidLeaveDays > 0 && <tr><td>Paid leave taken</td><td className="amt">{r.paidLeaveDays} day(s)</td></tr>}
            {r.unpaidDays > 0 && <tr><td>Unpaid leave taken</td><td className="amt">{r.unpaidDays} day(s)</td></tr>}
          </tbody>
        </table>
      </div>
      {r.remarks && <p className="ps-note"><strong>Remarks:</strong> {r.remarks}</p>}
      <p className="ps-note">This is a computer-generated payslip. Please keep it for your records.</p>
    </article>
  );
}
