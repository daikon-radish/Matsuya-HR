import { eachDay, monthsBetween, weekday, yearsBetween, type YMD } from '../dates';

/** MOM rounding for pro-rated leave: under half a day is dropped, half a day or more counts as one day. */
export function roundLeave(days: number): number {
  return Math.floor(days + 0.5);
}

/** Part-timers get leave pro-rated by their weekly hours against a 44-hour full-time week. */
export function partTimeFactor(employmentType: 'FT' | 'PT', contractHoursPerWeek: number | null): number {
  if (employmentType === 'FT') return 1;
  return Math.min(1, Math.max(0, (contractHoursPerWeek ?? 0) / 44));
}

/**
 * Employment Act annual leave for a calendar year: 7 days, +1 per completed year of service, up to 14.
 * Pro-rated in the year the employee joins. Only usable after 3 months of service.
 * Companies may give more; HR can override per employee per year.
 */
export function statutoryAnnualLeave(startDate: YMD, year: number, factor = 1): number {
  const yearEnd = `${year}-12-31`;
  if (startDate > yearEnd) return 0;
  const completedYears = Math.max(0, yearsBetween(startDate, yearEnd));
  const base = Math.min(14, 7 + completedYears);
  const startYear = Number(startDate.slice(0, 4));
  if (startYear === year) {
    const months = monthsBetween(startDate, `${year + 1}-01-01`);
    return roundLeave((base * months * factor) / 12);
  }
  return roundLeave(base * factor);
}

/** Employment Act paid sick leave by months of service (outpatient is part of hospitalisation). */
export function statutorySickLeave(startDate: YMD, asOf: YMD, factor = 1): { outpatient: number; hospitalisation: number } {
  const months = monthsBetween(startDate, asOf);
  let out = 0;
  let hosp = 0;
  if (months >= 6) [out, hosp] = [14, 60];
  else if (months >= 5) [out, hosp] = [11, 45];
  else if (months >= 4) [out, hosp] = [8, 30];
  else if (months >= 3) [out, hosp] = [5, 15];
  return { outpatient: roundLeave(out * factor), hospitalisation: roundLeave(hosp * factor) };
}

export function hasThreeMonthsService(startDate: YMD, asOf: YMD): boolean {
  return monthsBetween(startDate, asOf) >= 3;
}

/** Working days in a leave request: the employee's work days, excluding public holidays. */
export function countLeaveDays(start: YMD, end: YMD, halfDay: boolean, workDays: number[], holidays: Set<YMD>): number {
  if (end < start) return 0;
  const days = eachDay(start, end).filter((d) => workDays.includes(weekday(d)) && !holidays.has(d)).length;
  if (halfDay && start === end) return days ? 0.5 : 0;
  return days;
}
