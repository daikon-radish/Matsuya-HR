// Date helpers that work on 'YYYY-MM-DD' strings in UTC, so the browser's
// timezone can never shift a date by one day.

export type YMD = string;

export function parseYMD(s: YMD): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function toYMD(d: Date): YMD {
  return d.toISOString().slice(0, 10);
}

export function todayYMD(): YMD {
  return localYMD(new Date());
}

/** Calendar date of a local Date (e.g. from FullCalendar) as 'YYYY-MM-DD' */
export function localYMD(d: Date): YMD {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Local time of a Date as 'HH:MM' */
export function localHM(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function addDays(s: YMD, n: number): YMD {
  const d = parseYMD(s);
  d.setUTCDate(d.getUTCDate() + n);
  return toYMD(d);
}

/** 0 = Sunday … 6 = Saturday */
export function weekday(s: YMD): number {
  return parseYMD(s).getUTCDay();
}

export function eachDay(start: YMD, end: YMD): YMD[] {
  const out: YMD[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** month is 1-12 */
export function monthRange(year: number, month: number): [YMD, YMD] {
  const mm = String(month).padStart(2, '0');
  return [`${year}-${mm}-01`, `${year}-${mm}-${String(daysInMonth(year, month)).padStart(2, '0')}`];
}

/** Monday of the week containing s */
export function startOfWeek(s: YMD): YMD {
  const wd = weekday(s);
  return addDays(s, wd === 0 ? -6 : 1 - wd);
}

/** Whole years between two dates (age, years of service). */
export function yearsBetween(from: YMD, to: YMD): number {
  const a = parseYMD(from);
  const b = parseYMD(to);
  let years = b.getUTCFullYear() - a.getUTCFullYear();
  if (b.getUTCMonth() < a.getUTCMonth() || (b.getUTCMonth() === a.getUTCMonth() && b.getUTCDate() < a.getUTCDate())) years--;
  return years;
}

/** Whole months between two dates. */
export function monthsBetween(from: YMD, to: YMD): number {
  const a = parseYMD(from);
  const b = parseYMD(to);
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) months--;
  return months;
}

/** 'HH:MM' → minutes after midnight */
export function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

/** Hours worked for a shift; an end time before the start time means it ends after midnight. */
export function shiftHours(start: string, end: string, breakMinutes: number): number {
  let mins = timeToMinutes(end) - timeToMinutes(start);
  if (mins <= 0) mins += 24 * 60;
  return Math.max(0, (mins - (breakMinutes || 0)) / 60);
}

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function formatDate(s: YMD | null | undefined): string {
  if (!s) return '';
  const d = parseYMD(s);
  return `${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()].slice(0, 3)} ${d.getUTCFullYear()}`;
}
