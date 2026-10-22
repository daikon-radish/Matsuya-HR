import type { DatesSetArg, EventInput } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../lib/auth';
import { addDays, localYMD } from '../../lib/dates';
import { employeeColor, loadHolidays, useLoad } from '../../lib/data';
import { must, supabase } from '../../lib/supabase';
import type { LeaveRequest, Shift } from '../../lib/types';
import { holidayEvents, shiftEvent } from '../hr/Roster';

export default function MyShifts() {
  const { employee } = useAuth();
  const holidays = useLoad(loadHolidays, []);
  const [range, setRange] = useState<{ start: string; end: string } | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [leave, setLeave] = useState<LeaveRequest[]>([]);

  useEffect(() => {
    if (!range || !employee) return;
    Promise.all([
      supabase.from('shifts').select('*').eq('employee_id', employee.id).gte('date', addDays(range.start, -1)).lt('date', range.end),
      supabase.from('leave_requests').select('*').eq('employee_id', employee.id).in('status', ['approved', 'pending']).lte('start_date', range.end).gte('end_date', range.start),
    ]).then(([s, l]) => {
      setShifts(must(s) as Shift[]);
      setLeave(must(l) as LeaveRequest[]);
    });
  }, [range, employee]);

  const events = useMemo(() => {
    if (!employee) return [];
    const color = employeeColor(employee);
    const out: EventInput[] = shifts.map((s) => ({ ...shiftEvent(s, s.status === 'absent' ? 'Absent' : 'Shift', color), editable: false }));
    for (const l of leave) {
      out.push({ title: `${l.leave_type}${l.status === 'pending' ? ' (pending)' : ''}`, start: l.start_date, end: addDays(l.end_date, 1), allDay: true, backgroundColor: '#e5e7eb', borderColor: '#d1d5db', textColor: '#374151' });
    }
    out.push(...holidayEvents(holidays.data ?? []));
    return out;
  }, [shifts, leave, holidays.data, employee]);

  if (!employee) return null;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>My shifts</h1>
          <p>Your roster. Shifts are set by HR; update your availability if anything changes.</p>
        </div>
      </div>
      <div className="card calendar-card">
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin]}
          initialView={window.innerWidth < 700 ? 'timeGridDay' : 'timeGridWeek'}
          headerToolbar={{ left: 'prev,next today', center: 'title', right: 'timeGridDay,timeGridWeek,dayGridMonth' }}
          firstDay={1}
          height="auto"
          slotMinTime="06:00:00"
          slotMaxTime="24:00:00"
          eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
          slotLabelFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
          events={events}
          datesSet={(arg: DatesSetArg) => setRange({ start: localYMD(arg.start), end: localYMD(arg.end) })}
        />
      </div>
    </>
  );
}
