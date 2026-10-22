import { useNavigate, useParams } from 'react-router-dom';
import PayslipDoc from '../components/PayslipDoc';
import { MONTH_NAMES } from '../lib/dates';
import { loadSettings, useLoad } from '../lib/data';
import { must, supabase } from '../lib/supabase';
import type { Payslip, PayrollRun } from '../lib/types';

type Row = Payslip & { payroll_runs: Pick<PayrollRun, 'pay_date' | 'status'> };

/** One payslip (/payslip/:id) or a whole run (/payslips/run/:runId), ready to print or save as PDF. */
export default function PayslipPage() {
  const { id, runId } = useParams();
  const navigate = useNavigate();
  const settings = useLoad(loadSettings, []);
  const slips = useLoad(async () => {
    const q = supabase.from('payslips').select('*, payroll_runs(pay_date, status)');
    const rows = must(await (runId ? q.eq('run_id', runId) : q.eq('id', id!))) as Row[];
    return rows.sort((a, b) => a.result.employee.full_name.localeCompare(b.result.employee.full_name));
  }, [id, runId]);

  const first = slips.data?.[0];
  const title = first ? `Payslip ${MONTH_NAMES[first.month - 1]} ${first.year}${runId ? '' : ` - ${first.result.employee.full_name}`}` : 'Payslip';

  function print() {
    // The browser uses the page title as the default PDF file name.
    const old = document.title;
    document.title = title;
    window.print();
    document.title = old;
  }

  return (
    <>
      <div className="row no-print mb">
        <button className="btn" onClick={() => navigate(-1)}>← Back</button>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={print} disabled={!slips.data?.length}>Print / Save as PDF</button>
      </div>
      {slips.error && <div className="alert error">{slips.error}</div>}
      {slips.loading || settings.loading ? (
        <div className="loading">Loading…</div>
      ) : !slips.data?.length ? (
        <div className="card empty">Payslip not found.</div>
      ) : (
        <div className="stack">
          <p className="muted small no-print">Tip: in the print dialog choose "Save as PDF" as the printer to get a PDF file.</p>
          {slips.data.map((p) => (
            <PayslipDoc key={p.id} result={p.result} company={settings.data!.company} payDate={p.payroll_runs?.pay_date ?? null} draft={p.status !== 'finalized'} />
          ))}
        </div>
      )}
    </>
  );
}
