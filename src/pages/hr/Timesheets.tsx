import { useMemo, useRef, useState } from 'react';
import Modal from '../../components/Modal';
import MonthPicker, { currentMonth } from '../../components/MonthPicker';
import ShiftModal, { draftFromShift, type ShiftDraft } from '../../components/ShiftModal';
import { formatDate, monthRange, shiftHours, todayYMD, WEEKDAY_SHORT, weekday } from '../../lib/dates';
import { employeeColor, errorMessage, hhmm, loadEmployees, loadHolidays, useLoad } from '../../lib/data';
import { downloadWorkbook, parseDateCell, parseTimeCell, readFirstSheet } from '../../lib/excel';
import { must, supabase } from '../../lib/supabase';
import type { Employee, Shift } from '../../lib/types';

function paidHours(s: Shift): number {
  if (s.status === 'absent') return 0;
  if (s.actual_start && s.actual_end) return shiftHours(s.actual_start, s.actual_end, s.actual_break_minutes ?? s.break_minutes);
  return shiftHours(s.start_time, s.end_time, s.break_minutes);
}

interface ImportRow {
  line: number;
  employee?: Employee;
  name: string;
  date: string | null;
  start: string | null;
  end: string | null;
  breakMin: number;
  error?: string;
  existing?: Shift;
}

export default function Timesheets() {
  const [{ year, month }, setYM] = useState(currentMonth());
  const [start, end] = monthRange(year, month);
  const employees = useLoad(() => loadEmployees(), []);
  const holidays = useLoad(loadHolidays, []);
  const shifts = useLoad(async () => must(await supabase.from('shifts').select('*').gte('date', start).lte('date', end).order('date').order('start_time')) as Shift[], [start, end]);
  const [filter, setFilter] = useState('');
  const [modal, setModal] = useState<ShiftDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importRows, setImportRows] = useState<ImportRow[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const empList = employees.data ?? [];
  const byId = useMemo(() => new Map(empList.map((e) => [e.id, e])), [empList]);
  const phDates = useMemo(() => new Set((holidays.data ?? []).map((h) => h.date)), [holidays.data]);
  const list = (shifts.data ?? []).filter((s) => !filter || s.employee_id === filter);

  const totals = useMemo(() => {
    const m = new Map<string, { hours: number; shifts: number; ph: number; absent: number; unconfirmed: number }>();
    for (const s of shifts.data ?? []) {
      const t = m.get(s.employee_id) ?? { hours: 0, shifts: 0, ph: 0, absent: 0, unconfirmed: 0 };
      const h = paidHours(s);
      t.hours += h;
      if (s.status === 'absent') t.absent++;
      else t.shifts++;
      if (s.status === 'scheduled') t.unconfirmed++;
      if (phDates.has(s.date) && s.status !== 'absent') t.ph += h;
      m.set(s.employee_id, t);
    }
    return m;
  }, [shifts.data, phDates]);

  async function confirmPast() {
    const today = todayYMD();
    const ids = (shifts.data ?? []).filter((s) => s.status === 'scheduled' && s.date < today).map((s) => s.id);
    if (!ids.length) return setError('No past scheduled shifts to confirm this month.');
    if (!confirm(`Mark ${ids.length} past shift(s) as worked, using the scheduled hours?`)) return;
    try {
      must(await supabase.from('shifts').update({ status: 'worked' }).in('id', ids));
      shifts.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function downloadTemplate() {
    downloadWorkbook('Timesheet import template.xlsx', [
      {
        name: 'Hours',
        rows: [
          ['Employee', 'Date', 'Start', 'End', 'Break (min)'],
          [empList[0]?.full_name ?? 'Full name or employee code', `${start}`, '10:00', '18:00', 60],
        ],
        widths: [28, 12, 8, 8, 12],
      },
    ]);
  }

  async function onFile(file: File) {
    setError(null);
    try {
      const raw = await readFirstSheet(file);
      const find = (name: string) => {
        const n = name.trim().toLowerCase();
        return empList.find((e) => e.emp_code?.toLowerCase() === n) ?? empList.find((e) => e.full_name.trim().toLowerCase() === n);
      };
      const pick = (r: Record<string, unknown>, ...keys: string[]) => {
        const k = Object.keys(r).find((key) => keys.some((want) => key.trim().toLowerCase().startsWith(want)));
        return k ? r[k] : null;
      };
      const rows: ImportRow[] = raw.map((r, i) => {
        const name = String(pick(r, 'employee', 'name', 'staff') ?? '').trim();
        const row: ImportRow = {
          line: i + 2,
          name,
          employee: name ? find(name) : undefined,
          date: parseDateCell(pick(r, 'date')),
          start: parseTimeCell(pick(r, 'start', 'in', 'time in')),
          end: parseTimeCell(pick(r, 'end', 'out', 'time out')),
          breakMin: Number(pick(r, 'break') ?? 0) || 0,
        };
        if (!name) row.error = 'No employee';
        else if (!row.employee) row.error = `No employee called "${name}"`;
        else if (!row.date) row.error = 'Date not recognised';
        else if (!row.start || !row.end) row.error = 'Start/end time not recognised';
        return row;
      });
      // Match against existing shifts on the file's dates, whichever month they're in.
      const dates = rows.map((r) => r.date).filter((d): d is string => Boolean(d)).sort();
      if (dates.length) {
        const existing = must(await supabase.from('shifts').select('*').gte('date', dates[0]).lte('date', dates[dates.length - 1])) as Shift[];
        for (const r of rows) {
          if (r.employee && r.date) r.existing = existing.find((s) => s.employee_id === r.employee!.id && s.date === r.date);
        }
      }
      setImportRows(rows.filter((r) => r.name || r.date));
    } catch (err) {
      setError(`Couldn't read that file: ${errorMessage(err)}`);
    }
  }

  async function commitImport() {
    if (!importRows) return;
    const good = importRows.filter((r) => !r.error);
    try {
      for (const r of good) {
        if (r.existing) {
          must(
            await supabase
              .from('shifts')
              .update({ actual_start: r.start, actual_end: r.end, actual_break_minutes: r.breakMin, status: 'worked' })
              .eq('id', r.existing.id),
          );
        }
      }
      const inserts = good
        .filter((r) => !r.existing)
        .map((r) => ({ employee_id: r.employee!.id, date: r.date, start_time: r.start, end_time: r.end, break_minutes: r.breakMin, status: 'worked' }));
      if (inserts.length) must(await supabase.from('shifts').insert(inserts));
      setImportRows(null);
      shifts.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function exportExcel() {
    const detail = (shifts.data ?? []).map((s) => [
      byId.get(s.employee_id)?.full_name ?? '',
      s.date,
      WEEKDAY_SHORT[weekday(s.date)],
      hhmm(s.start_time),
      hhmm(s.end_time),
      hhmm(s.actual_start),
      hhmm(s.actual_end),
      s.actual_break_minutes ?? s.break_minutes,
      Number(paidHours(s).toFixed(2)),
      s.status,
      phDates.has(s.date) ? 'PH' : '',
      s.note ?? '',
    ]);
    const summary = empList
      .filter((e) => totals.has(e.id))
      .map((e) => {
        const t = totals.get(e.id)!;
        return [e.full_name, e.employment_type, t.shifts, Number(t.hours.toFixed(2)), Number(t.ph.toFixed(2)), t.absent, t.unconfirmed];
      });
    downloadWorkbook(`Timesheet ${year}-${String(month).padStart(2, '0')}.xlsx`, [
      { name: 'Summary', rows: [['Employee', 'Type', 'Shifts', 'Paid hours', 'PH hours', 'Absent', 'Unconfirmed'], ...summary], widths: [24, 6, 8, 10, 9, 8, 11] },
      {
        name: 'Shifts',
        rows: [['Employee', 'Date', 'Day', 'Sched start', 'Sched end', 'Actual start', 'Actual end', 'Break (min)', 'Paid hours', 'Status', 'PH', 'Note'], ...detail],
        widths: [24, 11, 5, 10, 10, 11, 10, 10, 10, 10, 4, 24],
      },
    ]);
  }

  const newShift = (): ShiftDraft => ({
    employee_id: filter,
    date: todayYMD() >= start && todayYMD() <= end ? todayYMD() : start,
    start_time: '10:00',
    end_time: '18:00',
    break_minutes: 60,
    actual_start: '',
    actual_end: '',
    actual_break_minutes: '',
    status: 'worked',
    day_type: 'auto',
    note: '',
  });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Timesheets</h1>
          <p>Hours actually worked. These feed straight into payroll.</p>
        </div>
        <div className="row">
          <button className="btn" onClick={downloadTemplate}>Import template</button>
          <button className="btn" onClick={() => fileRef.current?.click()}>Import from Excel</button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f); }} />
          <button className="btn" onClick={exportExcel}>Export to Excel</button>
          <button className="btn btn-primary" onClick={() => setModal(newShift())}>Add hours</button>
        </div>
      </div>
      {error && <div className="alert error">{error}</div>}

      <div className="card">
        <div className="card-head">
          <MonthPicker year={year} month={month} onChange={(y, m) => setYM({ year: y, month: m })} />
          <div className="row">
            <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 220 }}>
              <option value="">All employees</option>
              {empList.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select>
            <button className="btn" onClick={confirmPast}>Confirm past shifts</button>
          </div>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Employee</th>
                <th className="num">Shifts</th>
                <th className="num">Paid hours</th>
                <th className="num">PH hours</th>
                <th className="num">Absent</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {empList.filter((e) => totals.has(e.id) && (!filter || e.id === filter)).map((e) => {
                const t = totals.get(e.id)!;
                return (
                  <tr key={e.id}>
                    <td><span className="dot" style={{ background: employeeColor(e) }} />{e.full_name}</td>
                    <td className="num">{t.shifts}</td>
                    <td className="num">{t.hours.toFixed(2)}</td>
                    <td className="num">{t.ph ? t.ph.toFixed(2) : '—'}</td>
                    <td className="num">{t.absent || '—'}</td>
                    <td>{t.unconfirmed ? <span className="badge warn">{t.unconfirmed} unconfirmed</span> : <span className="badge ok">Confirmed</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!totals.size && !shifts.loading && <div className="empty">No hours recorded for this month yet.</div>}
        </div>
      </div>

      <div className="card">
        <h2 className="mb">Shifts</h2>
        {shifts.loading ? (
          <div className="loading">Loading…</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Employee</th>
                  <th>Scheduled</th>
                  <th>Actual</th>
                  <th className="num">Break</th>
                  <th className="num">Hours</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {list.map((s) => (
                  <tr key={s.id} className="clickable" onClick={() => setModal(draftFromShift(s))}>
                    <td className="nowrap">
                      {WEEKDAY_SHORT[weekday(s.date)]} {formatDate(s.date)} {phDates.has(s.date) && <span className="badge warn">PH</span>}
                    </td>
                    <td>{byId.get(s.employee_id)?.full_name}</td>
                    <td className="nowrap">{hhmm(s.start_time)}–{hhmm(s.end_time)}</td>
                    <td className="nowrap">{s.actual_start ? `${hhmm(s.actual_start)}–${hhmm(s.actual_end)}` : <span className="muted">as scheduled</span>}</td>
                    <td className="num">{s.actual_break_minutes ?? s.break_minutes}m</td>
                    <td className="num">{paidHours(s).toFixed(2)}</td>
                    <td>
                      <span className={`badge ${s.status === 'worked' ? 'ok' : s.status === 'absent' ? 'danger' : ''}`}>{s.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!list.length && <div className="empty">No shifts.</div>}
          </div>
        )}
      </div>

      {modal && (
        <ShiftModal
          initial={modal}
          employees={empList}
          availability={[]}
          leave={[]}
          shifts={shifts.data ?? []}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            shifts.reload();
          }}
        />
      )}

      {importRows && (
        <Modal
          title="Import hours"
          wide
          onClose={() => setImportRows(null)}
          footer={
            <>
              <button className="btn" onClick={() => setImportRows(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={commitImport} disabled={!importRows.some((r) => !r.error)}>
                Import {importRows.filter((r) => !r.error).length} row(s)
              </button>
            </>
          }
        >
          <p className="muted small">
            Rows matching an existing shift (same person and date) update its actual hours. Other rows become new shifts. All imported rows are marked as worked.
            Rows with problems are skipped.
          </p>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Row</th><th>Employee</th><th>Date</th><th>Hours</th><th>Result</th></tr>
              </thead>
              <tbody>
                {importRows.map((r) => (
                  <tr key={r.line}>
                    <td>{r.line}</td>
                    <td>{r.employee?.full_name ?? r.name}</td>
                    <td className="nowrap">{r.date ? formatDate(r.date) : '—'}</td>
                    <td className="nowrap">{r.start && r.end ? `${r.start}–${r.end} (${r.breakMin}m break)` : '—'}</td>
                    <td>
                      {r.error ? <span className="badge danger">{r.error}</span> : r.existing ? <span className="badge info">Update shift</span> : <span className="badge ok">New shift</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
    </>
  );
}
