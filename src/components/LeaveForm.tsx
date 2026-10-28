import { useMemo, useState } from 'react';
import { addMonths, formatDate, todayYMD } from '../lib/dates';
import { errorMessage } from '../lib/data';
import type { Balance } from '../lib/leaveBalance';
import { countLeaveDays, hasThreeMonthsService } from '../lib/payroll/leave';
import { must, supabase } from '../lib/supabase';
import type { Employee, Holiday, LeaveType } from '../lib/types';
import Modal from './Modal';

interface Props {
  /** HR can pick anyone; employees only themselves */
  employees: Employee[];
  fixedEmployeeId?: string;
  types: LeaveType[];
  holidays: Holiday[];
  /** Balances for the chosen employee (for a remaining-days hint) */
  balancesFor: (employeeId: string) => Balance[];
  asHR: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export default function LeaveForm({ employees, fixedEmployeeId, types, holidays, balancesFor, asHR, onClose, onSaved }: Props) {
  const [employeeId, setEmployeeId] = useState(fixedEmployeeId ?? '');
  const [type, setType] = useState(types[0]?.code ?? 'AL');
  const [start, setStart] = useState(todayYMD());
  const [end, setEnd] = useState(todayYMD());
  const [halfDay, setHalfDay] = useState(false);
  const [reason, setReason] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [approveNow, setApproveNow] = useState(asHR);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const emp = employees.find((e) => e.id === employeeId);
  const holidaySet = useMemo(() => new Set(holidays.map((h) => h.date)), [holidays]);
  const days = emp ? countLeaveDays(start, end < start ? start : end, halfDay && start === end, emp.work_days, holidaySet) : 0;
  const balance = emp ? balancesFor(emp.id).find((b) => b.code === type) : undefined;
  const isSick = type === 'MC' || type === 'HOSP';
  // Employment Act: annual leave can be taken only after 3 months' service
  const tooNewForAL = emp && type === 'AL' && !hasThreeMonthsService(emp.start_date, start);

  async function submit() {
    if (!employeeId) return setError('Choose an employee.');
    if (end < start) return setError('End date is before start date.');
    if (days === 0) return setError('Those dates are all rest days or public holidays, so no leave is needed.');
    setBusy(true);
    setError(null);
    try {
      let attachment_path: string | null = null;
      if (file) {
        const safe = file.name.replace(/[^\w.-]+/g, '_');
        attachment_path = `${employeeId}/${crypto.randomUUID()}-${safe}`;
        const { error: upErr } = await supabase.storage.from('leave-attachments').upload(attachment_path, file);
        if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
      }
      must(
        await supabase.from('leave_requests').insert({
          employee_id: employeeId,
          leave_type: type,
          start_date: start,
          end_date: end,
          half_day: halfDay && start === end,
          reason: reason || null,
          attachment_path,
          status: asHR && approveNow ? 'approved' : 'pending',
        }),
      );
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal
      title={asHR ? 'Record leave' : 'Apply for leave'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? 'Saving…' : asHR ? 'Save' : 'Submit request'}</button>
        </>
      }
    >
      {error && <div className="alert error">{error}</div>}
      <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        {!fixedEmployeeId && (
          <label className="field span-3">
            Employee
            <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">Choose…</option>
              {employees.filter((e) => e.active).map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select>
          </label>
        )}
        <label className="field span-3">
          Leave type
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {types.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
          </select>
        </label>
        <label className="field">
          From
          <input type="date" value={start} onChange={(e) => { setStart(e.target.value); if (end < e.target.value) setEnd(e.target.value); }} />
        </label>
        <label className="field">
          To
          <input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
        </label>
        {start === end && (
          <label className="check span-3">
            <input type="checkbox" checked={halfDay} onChange={(e) => setHalfDay(e.target.checked)} /> Half day
          </label>
        )}
        <div className="span-3">
          {emp && (
            <div className="alert info" style={{ marginBottom: 0 }}>
              {days} working day{days === 1 ? '' : 's'}
              {balance?.remaining != null && <> · {balance.remaining} {balance.name.toLowerCase()} left this year{balance.remaining - days < 0 && <strong> (not enough)</strong>}</>}
            </div>
          )}
          {tooNewForAL && (
            <div className="alert warn" style={{ marginTop: 8, marginBottom: 0 }}>
              {emp.full_name} joined on {formatDate(emp.start_date)}. Under the Employment Act, annual leave can be taken from {formatDate(addMonths(emp.start_date, 3))} (after 3 months' service).
            </div>
          )}
        </div>
        <label className="field span-3">
          Reason {isSick ? '' : '(optional)'}
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <label className="field span-3">
          {isSick ? 'Medical certificate (photo or PDF)' : 'Attachment (optional)'}
          <input type="file" accept="image/*,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        {asHR && (
          <label className="check span-3">
            <input type="checkbox" checked={approveNow} onChange={(e) => setApproveNow(e.target.checked)} /> Mark as approved
          </label>
        )}
      </div>
    </Modal>
  );
}

export async function openAttachment(path: string) {
  // Open the tab during the click: phone browsers (Safari) block tabs opened after waiting on the network.
  const win = window.open('', '_blank');
  if (win) win.opener = null;
  const { data, error } = await supabase.storage.from('leave-attachments').createSignedUrl(path, 120);
  if (error) {
    win?.close();
    return alert(error.message);
  }
  if (win) win.location.href = data.signedUrl;
  else window.location.href = data.signedUrl;
}
