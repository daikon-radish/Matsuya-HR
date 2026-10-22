import { timeToMinutes, weekday, type YMD } from './dates';
import { hhmm } from './data';
import type { Availability } from './types';

export interface DayAvailability {
  status: 'available' | 'unavailable' | 'unknown';
  /** Free window(s) on that day; empty = all day */
  windows: { start: string; end: string }[];
  /** Blocked window(s) when only part of the day is unavailable */
  blocked: { start: string; end: string }[];
  note: string | null;
  source: 'date' | 'weekly' | null;
}

/**
 * What an employee said about a given date. One-off date entries win over the weekly pattern.
 * If someone has filled in a weekly pattern, days they didn't tick count as unavailable;
 * if they never filled one in, the day is unknown.
 */
export function availabilityOn(employeeId: string, date: YMD, all: Availability[]): DayAvailability {
  const mine = all.filter((a) => a.employee_id === employeeId);
  const dated = mine.filter((a) => a.date === date);
  const win = (a: Availability) => ({ start: hhmm(a.start_time), end: hhmm(a.end_time) });
  const notes = (xs: Availability[]) => xs.map((a) => a.note).filter(Boolean).join('; ') || null;

  if (dated.length) {
    const allDayOff = dated.find((a) => !a.available && !a.start_time);
    if (allDayOff) return { status: 'unavailable', windows: [], blocked: [], note: allDayOff.note, source: 'date' };
    const free = dated.filter((a) => a.available);
    const blocked = dated.filter((a) => !a.available && a.start_time).map(win);
    if (free.length) {
      return { status: 'available', windows: free.filter((a) => a.start_time).map(win), blocked, note: notes(dated), source: 'date' };
    }
    // Only partly blocked: fall through to the weekly pattern, keeping the blocked hours.
    const base = weeklyOn(mine, date);
    return { ...base, blocked, note: notes(dated) ?? base.note, source: 'date' };
  }
  return weeklyOn(mine, date);
}

function weeklyOn(mine: Availability[], date: YMD): DayAvailability {
  const weekly = mine.filter((a) => a.weekday != null);
  if (!weekly.length) return { status: 'unknown', windows: [], blocked: [], note: null, source: null };
  const today = weekly.filter((a) => a.weekday === weekday(date) && a.available);
  if (!today.length) return { status: 'unavailable', windows: [], blocked: [], note: null, source: 'weekly' };
  return {
    status: 'available',
    windows: today.filter((a) => a.start_time).map((a) => ({ start: hhmm(a.start_time), end: hhmm(a.end_time) })),
    blocked: [],
    note: today.map((a) => a.note).filter(Boolean).join('; ') || null,
    source: 'weekly',
  };
}

/** Does a shift fit inside what the employee said they're free for? */
export function fitsShift(av: DayAvailability, start: string, end: string): 'yes' | 'partly' | 'no' | 'unknown' {
  if (av.status === 'unknown') return 'unknown';
  if (av.status === 'unavailable') return 'no';
  const s = timeToMinutes(start);
  let e = timeToMinutes(end);
  if (e <= s) e += 24 * 60;
  const overlapsBlock = av.blocked.some((b) => timeToMinutes(b.start) < e && timeToMinutes(b.end) > s);
  if (overlapsBlock) return 'partly';
  if (!av.windows.length) return 'yes';
  const inside = av.windows.some((w) => {
    let we = timeToMinutes(w.end);
    if (we <= timeToMinutes(w.start)) we += 24 * 60;
    return timeToMinutes(w.start) <= s && we >= e;
  });
  return inside ? 'yes' : 'partly';
}

export function describe(av: DayAvailability): string {
  if (av.status === 'unknown') return 'No availability given';
  if (av.status === 'unavailable') return `Not available${av.note ? ` (${av.note})` : ''}`;
  const w = av.windows.length ? av.windows.map((x) => `${x.start}–${x.end}`).join(', ') : 'all day';
  const b = av.blocked.length ? `, except ${av.blocked.map((x) => `${x.start}–${x.end}`).join(', ')}` : '';
  return `Available ${w}${b}${av.note ? ` (${av.note})` : ''}`;
}
