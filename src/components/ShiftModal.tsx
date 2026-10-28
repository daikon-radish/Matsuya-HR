import { useMemo, useState } from 'react';
import { availabilityOn, describe, fitsShift } from '../lib/availability';
import { addDays, formatDate, shiftHours } from '../lib/dates';
import { errorMessage, hhmm } from '../lib/data';
import { must, supabase } from '../lib/supabase';
import type { Availability, DayType, Employee, LeaveRequest, Shift } from '../lib/types';
import Modal from './Modal';

export interface ShiftDraft {
  id?: string;
  employee_id: string;
  date: string;
  start_time: string;
  end_time: string;
  break_minutes: number;
  actual_start: string;
  actual_end: string;
  actual_break_minutes: string;
  status: Shift['status'];
  day_type: DayType;
  note: string;
}

export function draftFromShift(s: Shift): ShiftDraft {
  return {
    id: s.id,
    employee_id: s.employee_id,
    date: s.date,
    start_time: hhmm(s.start_time),
    end_time: hhmm(s.end_time),
    break_minutes: s.break_minutes,
    actual_start: hhmm(s.actual_start),
    actual_end: hhmm(s.actual_end),
    actual_break_minutes: s.actual_break_minutes == null ? '' : String(s.actual_break_minutes),
    status: s.status,
    day_type: s.day_type,
    note: s.note ?? '',
  };
}

interface Props {
  initial: ShiftDraft;
  employees: Employee[];
  availability: Availability[];
  /** Approved leave around the shift date, to warn about clashes */
  leave: LeaveRequest[];
  /** Other shifts around the date, to warn about double-booking */
  shifts: Shift[];
  onClose: () => void;
  onSaved: () => void;
}

const FIT_LABEL = { yes: ['ok', 'Available'], partly: ['warn', 'Partly available'], no: ['danger', 'Not available'], unknown: ['', 'No availability given'] } as const;

export default function ShiftModal({ initial, employees, availability, leave, shifts, onClose, onSaved }: Props) {
  const [d, setD] = useState<ShiftDraft>(initial);
  const [repeat, setRepeat] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof ShiftDraft>(k: K, v: ShiftDraft[K]) => setD((x) => ({ ...x, [k]: v }));

  const hours = shiftHours(d.start_time, d.end_time, d.break_minutes);
  const actualHours = d.actual_start && d.actual_end ? shiftHours(d.actual_start, d.actual_end, d.actual_break_minutes === '' ? d.break_minutes : Number(d.actual_break_minutes)) : null;

  // Everyone's fit for this slot, best first, to help pick who to roster.
  const candidates = useMemo(() => {
    const rank = { yes: 0, unknown: 1, partly: 2, no: 3 };
    return employees
      .filter((e) => e.active)
      .map((e) => {
        const av = availabilityOn(e.id, d.date, availability);
        const onLeave = leave.find((l) => l.employee_id === e.id && l.status === 'approved' && l.start_date <= d.date && l.end_date >= d.date);
        const booked = shifts.some((s) => s.employee_id === e.id && s.date === d.date && s.id !== d.id);
        const fit = onLeave ? 'no' : fitsShift(av, d.start_time, d.end_time);
        return { e, av, fit, onLeave, booked };
      })
      .sort((a, b) => rank[a.fit] - rank[b.fit] || a.e.full_name.localeCompare(b.e.full_name));
  }, [employees, availability, leave, shifts, d.date, d.start_time, d.end_time, d.id]);

  const selected = candidates.find((c) => c.e.id === d.employee_id);

  // Repeated weeks the chosen employee said they can't (fully) work
  const repeatClashes = useMemo(() => {
    if (!d.employee_id || !repeat) return [];
    return Array.from({ length: repeat }, (_, i) => addDays(d.date, 7 * (i + 1))).filter((date) => {
      const fit = fitsShift(availabilityOn(d.employee_id, date, availability), d.start_time, d.end_time);
      return fit === 'no' || fit === 'partly';
    });
  }, [d.employee_id, d.date, d.start_time, d.end_time, repeat, availability]);
  const [skipClashes, setSkipClashes] = useState(true);

  async function save() {
    if (!d.employee_id) return setError('Choose an employee.');
    setBusy(true);
    setError(null);
    const row = {
      employee_id: d.employee_id,
      date: d.date,
      start_time: d.start_time,
      end_time: d.end_time,
      break_minutes: d.break_minutes || 0,
      actual_start: d.actual_start || null,
      actual_end: d.actual_end || null,
      actual_break_minutes: d.actual_break_minutes === '' ? null : Number(d.actual_break_minutes),
      status: d.status,
      day_type: d.day_type,
      note: d.note || null,
    };
    try {
      if (d.id) must(await supabase.from('shifts').update(row).eq('id', d.id));
      else {
        const repeats = Array.from({ length: repeat }, (_, i) => addDays(d.date, 7 * (i + 1))).filter((date) => !(skipClashes && repeatClashes.includes(date)));
        const rows = [row, ...repeats.map((date) => ({ ...row, date }))];
        must(await supabase.from('shifts').insert(rows));
      }
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  async function remove() {
    if (!d.id || !confirm('Delete this shift?')) return;
    try {
      must(await supabase.from('shifts').delete().eq('id', d.id));
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Modal
      title={d.id ? 'Edit shift' : 'New shift'}
      onClose={onClose}
      wide
      footer={
        <>
          {d.id && <button className="btn btn-danger" onClick={remove} style={{ marginRight: 'auto' }}>Delete</button>}
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save shift'}</button>
        </>
      }
    >
      {error && <div className="alert error">{error}</div>}
      <div className="grid grid-2">
        <div className="stack">
          <label className="field">
            Employee
            <select value={d.employee_id} onChange={(e) => set('employee_id', e.target.value)}>
              <option value="">Choose…</option>
              {candidates.map(({ e, fit, onLeave }) => (
                <option key={e.id} value={e.id}>
                  {e.full_name} — {onLeave ? `on ${onLeave.leave_type}` : FIT_LABEL[fit][1]}
                </option>
              ))}
            </select>
          </label>
          {selected && (
            <div className={`alert ${selected.fit === 'yes' ? 'ok' : selected.fit === 'unknown' ? 'info' : 'warn'}`}>
              {selected.onLeave ? `On approved ${selected.onLeave.leave_type} leave this day.` : describe(selected.av)}
              {selected.booked && <div>Already has another shift this day.</div>}
            </div>
          )}
          <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <label className="field span-3">
              Date
              <input type="date" value={d.date} onChange={(e) => set('date', e.target.value)} />
            </label>
            <label className="field">
              Start
              <input type="time" value={d.start_time} onChange={(e) => set('start_time', e.target.value)} />
            </label>
            <label className="field">
              End
              <input type="time" value={d.end_time} onChange={(e) => set('end_time', e.target.value)} />
            </label>
            <label className="field">
              Unpaid break (minutes)
              <input type="number" min="0" step="5" value={d.break_minutes} onChange={(e) => set('break_minutes', Number(e.target.value))} />
            </label>
            <div className="field" style={{ justifyContent: 'flex-end' }}>
              <span className="muted">= {Number(hours.toFixed(2))} paid hours</span>
            </div>
            {!d.id && (
              <label className="field span-3">
                Repeat weekly
                <select value={repeat} onChange={(e) => setRepeat(Number(e.target.value))}>
                  <option value={0}>Don't repeat</option>
                  {[1, 2, 3, 5, 7, 11].map((n) => <option key={n} value={n}>For {n + 1} weeks</option>)}
                </select>
              </label>
            )}
            {!d.id && repeatClashes.length > 0 && (
              <div className="alert warn span-3" style={{ marginBottom: 0 }}>
                {selected?.e.full_name} isn't (fully) available on {repeatClashes.map(formatDate).join(', ')}.
                <label className="check mt">
                  <input type="checkbox" checked={skipClashes} onChange={(e) => setSkipClashes(e.target.checked)} /> Don't add the shift on those dates
                </label>
              </div>
            )}
          </div>
        </div>
        <div className="stack">
          <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <label className="field">
              Status
              <select value={d.status} onChange={(e) => set('status', e.target.value as Shift['status'])}>
                <option value="scheduled">Scheduled</option>
                <option value="worked">Worked (confirmed)</option>
                <option value="absent">Absent / no-show</option>
              </select>
            </label>
            <label className="field">
              Day type
              <select value={d.day_type} onChange={(e) => set('day_type', e.target.value as DayType)}>
                <option value="auto">Automatic</option>
                <option value="normal">Normal day</option>
                <option value="rest_day">Rest day</option>
                <option value="public_holiday">Public holiday</option>
              </select>
            </label>
            <div className="section-title">Actual hours (if different)</div>
            <label className="field">
              Actual start
              <input type="time" value={d.actual_start} onChange={(e) => set('actual_start', e.target.value)} />
            </label>
            <label className="field">
              Actual end
              <input type="time" value={d.actual_end} onChange={(e) => set('actual_end', e.target.value)} />
            </label>
            <label className="field">
              Actual break (min)
              <input type="number" min="0" step="5" value={d.actual_break_minutes} placeholder={String(d.break_minutes)} onChange={(e) => set('actual_break_minutes', e.target.value)} />
            </label>
            <div className="field" style={{ justifyContent: 'flex-end' }}>
              {actualHours != null && <span className="muted">= {Number(actualHours.toFixed(2))} paid hours</span>}
            </div>
            <label className="field span-3">
              Note
              <input value={d.note} onChange={(e) => set('note', e.target.value)} />
            </label>
          </div>
          <p className="muted small">"Automatic" day type marks public holidays from Settings, and days outside a full-timer's normal work days as rest days.</p>
        </div>
      </div>
    </Modal>
  );
}
