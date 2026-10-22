import type { DateSelectArg, DatesSetArg, EventClickArg, EventDropArg, EventInput } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin, { type EventResizeDoneArg } from '@fullcalendar/interaction';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import { useCallback, useEffect, useMemo, useState } from 'react';
import ShiftModal, { draftFromShift, type ShiftDraft } from '../../components/ShiftModal';
import { availabilityOn, describe } from '../../lib/availability';
import { addDays, eachDay, formatDate, localHM, localYMD, shiftHours, WEEKDAY_SHORT, weekday } from '../../lib/dates';
import { employeeColor, errorMessage, hhmm, loadEmployees, loadHolidays, useLoad } from '../../lib/data';
import { downloadWorkbook } from '../../lib/excel';
import { must, supabase } from '../../lib/supabase';
import type { Availability, Holiday, LeaveRequest, Shift } from '../../lib/types';

export function shiftEvent(s: Shift, title: string, color: string): EventInput {
  const start = hhmm(s.actual_start ?? s.start_time);
  const end = hhmm(s.actual_end ?? s.end_time);
  const endDate = end <= start ? addDays(s.date, 1) : s.date;
  return {
    id: s.id,
    title,
    start: `${s.date}T${start}`,
    end: `${endDate}T${end}`,
    backgroundColor: s.status === 'absent' ? '#9ca3af' : color,
    borderColor: s.status === 'absent' ? '#9ca3af' : color,
    textColor: '#fff',
    classNames: s.status === 'absent' ? ['shift-absent'] : [],
    extendedProps: { shift: s },
  };
}

export function holidayEvents(holidays: Holiday[]): EventInput[] {
  return holidays.map((h) => ({ start: h.date, allDay: true, display: 'background', backgroundColor: '#fde68a', title: h.name }));
}

export default function Roster() {
  const employees = useLoad(() => loadEmployees(true), []);
  const holidays = useLoad(loadHolidays, []);
  const availability = useLoad(async () => must(await supabase.from('availability').select('*')) as Availability[], []);
  const [range, setRange] = useState<{ start: string; end: string } | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [leave, setLeave] = useState<LeaveRequest[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [overlay, setOverlay] = useState('');
  const [modal, setModal] = useState<ShiftDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState('timeGridWeek');

  const loadRange = useCallback(async () => {
    if (!range) return;
    try {
      const [s, l] = await Promise.all([
        supabase.from('shifts').select('*').gte('date', addDays(range.start, -1)).lt('date', range.end),
        supabase.from('leave_requests').select('*').eq('status', 'approved').lte('start_date', range.end).gte('end_date', range.start),
      ]);
      setShifts(must(s) as Shift[]);
      setLeave(must(l) as LeaveRequest[]);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [range]);

  useEffect(() => {
    loadRange();
  }, [loadRange]);

  const empList = employees.data ?? [];
  const byId = useMemo(() => new Map(empList.map((e) => [e.id, e])), [empList]);

  const events = useMemo(() => {
    const out: EventInput[] = [];
    for (const s of shifts) {
      const e = byId.get(s.employee_id);
      if (!e || hidden.has(e.id)) continue;
      out.push(shiftEvent(s, e.full_name, employeeColor(e)));
    }
    for (const l of leave) {
      const e = byId.get(l.employee_id);
      if (!e || hidden.has(e.id)) continue;
      out.push({ title: `${e.full_name} · ${l.leave_type}`, start: l.start_date, end: addDays(l.end_date, 1), allDay: true, backgroundColor: '#e5e7eb', borderColor: '#d1d5db', textColor: '#374151', editable: false });
    }
    out.push(...holidayEvents(holidays.data ?? []));
    // Availability overlay for one employee: green = free, red = not available
    if (overlay && range) {
      for (const date of eachDay(range.start, addDays(range.end, -1))) {
        const av = availabilityOn(overlay, date, availability.data ?? []);
        if (av.status === 'unavailable') out.push({ start: date, end: addDays(date, 1), display: 'background', backgroundColor: '#ef4444', allDay: view === 'dayGridMonth' });
        if (av.status === 'available') {
          if (!av.windows.length) out.push({ start: date, end: addDays(date, 1), display: 'background', backgroundColor: '#22c55e', allDay: view === 'dayGridMonth' });
          for (const w of av.windows) {
            const endDate = w.end <= w.start ? addDays(date, 1) : date;
            out.push({ start: `${date}T${w.start}`, end: `${endDate}T${w.end}`, display: 'background', backgroundColor: '#22c55e' });
          }
          for (const b of av.blocked) out.push({ start: `${date}T${b.start}`, end: `${date}T${b.end}`, display: 'background', backgroundColor: '#ef4444' });
        }
      }
    }
    return out;
  }, [shifts, leave, byId, hidden, holidays.data, overlay, range, availability.data, view]);

  function onDates(arg: DatesSetArg) {
    setView(arg.view.type);
    setRange({ start: localYMD(arg.start), end: localYMD(arg.end) });
  }

  function onSelect(arg: DateSelectArg) {
    const date = localYMD(arg.start);
    const timed = !arg.allDay;
    setModal({
      employee_id: overlay,
      date,
      start_time: timed ? localHM(arg.start) : '10:00',
      end_time: timed ? localHM(arg.end) : '18:00',
      break_minutes: 60,
      actual_start: '',
      actual_end: '',
      actual_break_minutes: '',
      status: 'scheduled',
      day_type: 'auto',
      note: '',
    });
  }

  function onClick(arg: EventClickArg) {
    const s = arg.event.extendedProps.shift as Shift | undefined;
    if (s) setModal(draftFromShift(s));
  }

  async function onMove(arg: EventDropArg | EventResizeDoneArg) {
    const s = arg.event.extendedProps.shift as Shift | undefined;
    if (!s || !arg.event.start || !arg.event.end) return arg.revert();
    try {
      must(
        await supabase
          .from('shifts')
          .update({ date: localYMD(arg.event.start), start_time: localHM(arg.event.start), end_time: localHM(arg.event.end), actual_start: null, actual_end: null })
          .eq('id', s.id),
      );
      loadRange();
    } catch (err) {
      arg.revert();
      setError(errorMessage(err));
    }
  }

  async function copyPreviousWeek() {
    if (!range || view !== 'timeGridWeek') return;
    const prevStart = addDays(range.start, -7);
    try {
      const prev = must(await supabase.from('shifts').select('*').gte('date', prevStart).lt('date', range.start)) as Shift[];
      if (!prev.length) return setError('No shifts in the previous week to copy.');
      if (!confirm(`Copy ${prev.length} shift(s) from the week of ${formatDate(prevStart)} into this week?`)) return;
      const rows = prev.map((s) => ({
        employee_id: s.employee_id,
        date: addDays(s.date, 7),
        start_time: s.start_time,
        end_time: s.end_time,
        break_minutes: s.break_minutes,
        status: 'scheduled',
        day_type: s.day_type,
        note: s.note,
      }));
      must(await supabase.from('shifts').insert(rows));
      loadRange();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function exportExcel() {
    if (!range) return;
    const days = eachDay(range.start, addDays(range.end, -1));
    const head = ['Employee', ...days.map((d) => `${WEEKDAY_SHORT[weekday(d)]} ${formatDate(d)}`), 'Total hours'];
    const rosterRows = empList.map((e) => {
      let total = 0;
      const cells = days.map((d) => {
        const mine = shifts.filter((s) => s.employee_id === e.id && s.date === d && s.status !== 'absent');
        const onLeave = leave.find((l) => l.employee_id === e.id && l.start_date <= d && l.end_date >= d);
        mine.forEach((s) => (total += shiftHours(s.start_time, s.end_time, s.break_minutes)));
        if (mine.length) return mine.map((s) => `${hhmm(s.start_time)}–${hhmm(s.end_time)}`).join(', ');
        return onLeave ? onLeave.leave_type : '';
      });
      return [e.full_name, ...cells, Number(total.toFixed(2))];
    });
    const availRows = empList.map((e) => [
      e.full_name,
      ...days.map((d) => {
        const av = availabilityOn(e.id, d, availability.data ?? []);
        return av.status === 'unknown' ? '' : describe(av).replace('Available ', '');
      }),
    ]);
    const weeklyRows = empList.map((e) => [
      e.full_name,
      ...[1, 2, 3, 4, 5, 6, 0].map((wd) => {
        const rows = (availability.data ?? []).filter((a) => a.employee_id === e.id && a.weekday === wd && a.available);
        return rows.map((a) => (a.start_time ? `${hhmm(a.start_time)}–${hhmm(a.end_time)}` : 'All day')).join(', ');
      }),
    ]);
    const widths = [24, ...days.map(() => 16), 10];
    downloadWorkbook(`Roster ${range.start} to ${addDays(range.end, -1)}.xlsx`, [
      { name: 'Roster', rows: [head, ...rosterRows], widths },
      { name: 'Availability (these dates)', rows: [head.slice(0, -1), ...availRows], widths },
      { name: 'Weekly availability', rows: [['Employee', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], ...weeklyRows], widths: [24, 14, 14, 14, 14, 14, 14, 14] },
    ]);
  }

  const toggle = (id: string) =>
    setHidden((h) => {
      const n = new Set(h);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Roster</h1>
          <p>Drag across the calendar to add a shift. Drag a shift to move it.</p>
        </div>
        <div className="row">
          {view === 'timeGridWeek' && <button className="btn" onClick={copyPreviousWeek}>Copy last week</button>}
          <button className="btn" onClick={exportExcel}>Export to Excel</button>
        </div>
      </div>
      {error && <div className="alert error" onClick={() => setError(null)}>{error}</div>}
      <div className="card calendar-card">
        <div className="row mb" style={{ justifyContent: 'space-between' }}>
          <div className="legend">
            {empList.map((e) => (
              <button key={e.id} className={hidden.has(e.id) ? 'off' : ''} onClick={() => toggle(e.id)} title="Show/hide">
                <span className="dot" style={{ background: employeeColor(e) }} />
                {e.full_name}
              </button>
            ))}
          </div>
          <label className="field" style={{ width: 240 }}>
            Show availability for
            <select value={overlay} onChange={(e) => setOverlay(e.target.value)}>
              <option value="">Nobody</option>
              {empList.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select>
          </label>
        </div>
        <FullCalendar
          plugins={[timeGridPlugin, dayGridPlugin, interactionPlugin]}
          initialView="timeGridWeek"
          headerToolbar={{ left: 'prev,next today', center: 'title', right: 'timeGridDay,timeGridWeek,dayGridMonth' }}
          firstDay={1}
          height="auto"
          slotMinTime="06:00:00"
          slotMaxTime="24:00:00"
          scrollTime="09:00:00"
          allDaySlot
          nowIndicator
          selectable
          selectMirror
          editable
          eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
          slotLabelFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
          events={events}
          datesSet={onDates}
          select={onSelect}
          eventClick={onClick}
          eventDrop={onMove}
          eventResize={onMove}
        />
      </div>
      {modal && (
        <ShiftModal
          initial={modal}
          employees={empList}
          availability={availability.data ?? []}
          leave={leave}
          shifts={shifts}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            loadRange();
          }}
        />
      )}
    </>
  );
}
