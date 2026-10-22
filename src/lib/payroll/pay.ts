import { eachDay, monthRange, shiftHours, startOfWeek, weekday, type YMD } from '../dates';
import type { Employee, LeaveRequest, LeaveType, PayrollSettings, Shift } from '../types';
import { computeCpf, type CpfResult } from './cpf';
import { sdl, shgContribution, type ShgFund } from './shg';

export type WageType = 'OW' | 'AW' | 'NONE';

export interface PayLine {
  code: string;
  label: string;
  amount: number;
  /** OW/AW count for CPF; NONE is not a wage (e.g. expense reimbursement) */
  wageType: WageType;
  detail?: string;
  auto: boolean;
}

export interface DeductionLine {
  code: string;
  label: string;
  amount: number;
  /** Unpaid leave / incomplete month reduce the wages CPF is calculated on */
  reducesWages: boolean;
  detail?: string;
  auto: boolean;
}

export interface ExtraEarning {
  label: string;
  amount: number;
  wageType: WageType;
}

export interface ExtraDeduction {
  label: string;
  amount: number;
}

/** What HR can adjust on a draft payslip. Everything else is calculated. */
export interface PayrollOverrides {
  otHours?: number | null;
  unpaidDays?: number | null;
  /** Codes of calculated lines HR has switched off (e.g. PH pay when time-off-in-lieu is given) */
  disabled?: string[];
  extraEarnings?: ExtraEarning[];
  extraDeductions?: ExtraDeduction[];
  remarks?: string;
}

export interface PayslipResult {
  year: number;
  month: number;
  periodStart: YMD;
  periodEnd: YMD;
  employee: {
    id: string;
    full_name: string;
    emp_code: string | null;
    job_title: string | null;
    employment_type: 'FT' | 'PT';
    nric_last4: string | null;
  };
  earnings: PayLine[];
  deductions: DeductionLine[];
  hours: { worked: number; normal: number; ot: number; publicHoliday: number; restDay: number };
  workingDays: number;
  daysPaid: number;
  unpaidDays: number;
  paidLeaveDays: number;
  ow: number;
  aw: number;
  grossWages: number;
  totalEarnings: number;
  totalDeductions: number;
  net: number;
  cpf: CpfResult;
  shgFund: ShgFund;
  shg: number;
  sdl: number;
  employerCost: number;
  remarks?: string;
  warnings: string[];
}

export interface PayrollInput {
  year: number;
  month: number;
  employee: Employee;
  /** Shifts in the month for this employee */
  shifts: Shift[];
  /** Approved leave overlapping the month */
  leaves: LeaveRequest[];
  leaveTypes: LeaveType[];
  holidays: Set<YMD>;
  settings: PayrollSettings;
  ytdOwSubject?: number;
  ytdAwSubject?: number;
  overrides?: PayrollOverrides;
}

const money = (x: number) => Math.round(x * 100) / 100;
const fmt = (x: number) => x.toFixed(2);
const hrs = (x: number) => `${Number(x.toFixed(2))} h`;

/** Hourly basic rate for a monthly-rated employee (MOM formula). */
export function hourlyBasicRate(monthlyBasic: number): number {
  return (12 * monthlyBasic) / (52 * 44);
}

/** Daily basic rate for a monthly-rated employee (MOM formula). */
export function dailyBasicRate(monthlyBasic: number, daysPerWeek: number): number {
  return (12 * monthlyBasic) / (52 * daysPerWeek);
}

function shiftActualHours(s: Shift): number {
  if (s.actual_start && s.actual_end) return shiftHours(s.actual_start, s.actual_end, s.actual_break_minutes ?? s.break_minutes);
  return shiftHours(s.start_time, s.end_time, s.break_minutes);
}

export function calculatePayslip(input: PayrollInput): PayslipResult {
  const { year, month, employee: emp, holidays, settings } = input;
  const ov = input.overrides ?? {};
  const disabled = new Set(ov.disabled ?? []);
  const warnings: string[] = [];
  const [monthStart, monthEnd] = monthRange(year, month);
  const empStart = emp.start_date > monthStart ? emp.start_date : monthStart;
  const empEnd = emp.end_date && emp.end_date < monthEnd ? emp.end_date : monthEnd;
  const isFT = emp.employment_type === 'FT';
  const workDays = emp.work_days?.length ? emp.work_days : [1, 2, 3, 4, 5];
  const daysPerWeek = workDays.length;
  const normalDailyHours = Math.min(settings.ot_daily_threshold, settings.ot_weekly_threshold / daysPerWeek);

  const inEmployment = (d: YMD) => d >= empStart && d <= empEnd;
  const isWorkingDay = (d: YMD) => workDays.includes(weekday(d));

  // ---- Working days (public holidays count as paid working days) ----
  const monthDays = eachDay(monthStart, monthEnd);
  const workingDays = monthDays.filter(isWorkingDay).length;
  const employedWorkingDays = empStart <= empEnd ? monthDays.filter((d) => isWorkingDay(d) && inEmployment(d)).length : 0;

  // ---- Leave ----
  const typeByCode = new Map(input.leaveTypes.map((t) => [t.code, t]));
  let unpaidDaysCalc = 0;
  let paidLeaveDays = 0;
  for (const l of input.leaves) {
    if (l.status !== 'approved') continue;
    const paid = typeByCode.get(l.leave_type)?.paid ?? true;
    const from = l.start_date > monthStart ? l.start_date : monthStart;
    const to = l.end_date < monthEnd ? l.end_date : monthEnd;
    if (from > to) continue;
    const days = eachDay(from, to).filter((d) => isWorkingDay(d) && !holidays.has(d) && inEmployment(d)).length;
    const counted = l.half_day && l.start_date === l.end_date ? days * 0.5 : days;
    if (paid) paidLeaveDays += counted;
    else unpaidDaysCalc += counted;
  }
  const unpaidDays = ov.unpaidDays ?? unpaidDaysCalc;

  // ---- Shifts → hours ----
  type Classified = { date: YMD; hours: number; dayType: 'normal' | 'rest_day' | 'public_holiday' };
  const worked: Classified[] = input.shifts
    .filter((s) => s.status !== 'absent' && s.date >= monthStart && s.date <= monthEnd && inEmployment(s.date))
    .map((s) => {
      let dayType: Classified['dayType'];
      if (s.day_type !== 'auto') dayType = s.day_type;
      else if (holidays.has(s.date)) dayType = 'public_holiday';
      // Part-timers are paid by the hour every day ("weekends same pay"), so no rest-day premium.
      else if (isFT && !isWorkingDay(s.date)) dayType = 'rest_day';
      else dayType = 'normal';
      return { date: s.date, hours: shiftActualHours(s), dayType };
    });

  const totalHours = worked.reduce((a, s) => a + s.hours, 0);
  const phHours = worked.filter((s) => s.dayType === 'public_holiday').reduce((a, s) => a + s.hours, 0);
  const restShifts = worked.filter((s) => s.dayType === 'rest_day');
  const restHours = restShifts.reduce((a, s) => a + s.hours, 0);

  // ---- Overtime: > daily threshold per day, then > weekly threshold per Mon–Sun week ----
  // Weeks spanning two months are counted within each month separately.
  let otCalc = 0;
  if (emp.ot_eligible) {
    const byDay = new Map<YMD, number>();
    for (const s of worked) {
      if (s.dayType === 'rest_day') continue;
      byDay.set(s.date, (byDay.get(s.date) ?? 0) + s.hours);
    }
    const weekNormal = new Map<YMD, number>();
    for (const [date, h] of byDay) {
      const dailyOt = Math.max(0, h - settings.ot_daily_threshold);
      otCalc += dailyOt;
      const wk = startOfWeek(date);
      weekNormal.set(wk, (weekNormal.get(wk) ?? 0) + (h - dailyOt));
    }
    for (const h of weekNormal.values()) otCalc += Math.max(0, h - settings.ot_weekly_threshold);
    // Rest-day work beyond a normal day's hours is overtime
    if (isFT) for (const s of restShifts) otCalc += Math.max(0, s.hours - normalDailyHours);
  }
  const otHours = ov.otHours ?? otCalc;
  if (otHours > 72) warnings.push(`Overtime of ${hrs(otHours)} exceeds the MOM limit of 72 hours a month.`);

  const earnings: PayLine[] = [];
  const deductions: DeductionLine[] = [];
  const addEarning = (l: Omit<PayLine, 'auto'>) => {
    if (l.amount !== 0 && !disabled.has(l.code)) earnings.push({ ...l, amount: money(l.amount), auto: true });
  };
  const addDeduction = (l: Omit<DeductionLine, 'auto'>) => {
    if (l.amount !== 0 && !disabled.has(l.code)) deductions.push({ ...l, amount: money(l.amount), auto: true });
  };

  let normalHours = 0;
  if (isFT) {
    const basic = emp.monthly_basic ?? 0;
    if (!basic) warnings.push('No monthly basic salary set for this full-timer.');
    const allowance = emp.fixed_allowance ?? 0;
    const grossRate = basic + allowance;
    addEarning({ code: 'BASIC', label: 'Basic salary', amount: basic, wageType: 'OW' });
    addEarning({ code: 'ALLOWANCE', label: 'Fixed allowance', amount: allowance, wageType: 'OW' });

    // MOM incomplete-month formula: monthly gross rate × days not worked ÷ working days in the month
    const notEmployed = workingDays - employedWorkingDays;
    if (notEmployed > 0 && workingDays > 0) {
      const why = emp.start_date > monthStart ? `joined ${emp.start_date}` : `last day ${emp.end_date}`;
      addDeduction({
        code: 'INCOMPLETE',
        label: 'Incomplete month',
        amount: (grossRate * notEmployed) / workingDays,
        reducesWages: true,
        detail: `${why}: ${notEmployed} of ${workingDays} working days`,
      });
    }
    if (unpaidDays > 0 && workingDays > 0) {
      addDeduction({
        code: 'UNPAID',
        label: 'Unpaid leave',
        amount: (grossRate * unpaidDays) / workingDays,
        reducesWages: true,
        detail: `${unpaidDays} day(s) × $${fmt(grossRate)} ÷ ${workingDays} working days`,
      });
    }

    const hourly = hourlyBasicRate(basic);
    const daily = dailyBasicRate(basic, daysPerWeek);
    if (otHours > 0 && emp.ot_eligible) {
      addEarning({
        code: 'OT',
        label: 'Overtime pay',
        amount: otHours * hourly * settings.ot_multiplier,
        wageType: 'OW',
        detail: `${hrs(otHours)} × $${fmt(hourly)} × ${settings.ot_multiplier}`,
      });
    }
    const phDays = new Set(worked.filter((s) => s.dayType === 'public_holiday').map((s) => s.date)).size;
    if (phDays > 0) {
      addEarning({
        code: 'PH',
        label: 'Public holiday worked (extra day)',
        amount: phDays * daily,
        wageType: 'OW',
        detail: `${phDays} day(s) × $${fmt(daily)}`,
      });
    }
    // Rest-day pay under Part IV (employer-requested): up to half a normal day = half day's pay, more = full day's pay
    if (emp.ot_eligible && restShifts.length) {
      const restDays = restShifts.reduce((a, s) => a + (s.hours <= normalDailyHours / 2 ? 0.5 : 1), 0);
      addEarning({
        code: 'REST',
        label: 'Rest day worked',
        amount: restDays * daily,
        wageType: 'OW',
        detail: `${restDays} day(s) × $${fmt(daily)}`,
      });
    }
    normalHours = Math.max(0, totalHours - otHours);
  } else {
    const rate = emp.hourly_rate ?? 0;
    if (!rate) warnings.push('No hourly rate set for this part-timer.');
    normalHours = Math.max(0, totalHours - (emp.ot_eligible ? otHours : 0));
    addEarning({ code: 'BASIC', label: 'Hourly wages', amount: normalHours * rate, wageType: 'OW', detail: `${hrs(normalHours)} × $${fmt(rate)}` });
    addEarning({ code: 'ALLOWANCE', label: 'Fixed allowance', amount: emp.fixed_allowance ?? 0, wageType: 'OW' });
    if (otHours > 0 && emp.ot_eligible) {
      addEarning({
        code: 'OT',
        label: 'Overtime pay',
        amount: otHours * rate * settings.ot_multiplier,
        wageType: 'OW',
        detail: `${hrs(otHours)} × $${fmt(rate)} × ${settings.ot_multiplier}`,
      });
    }
    // Extra pay for hours worked on a public holiday (on top of the normal hourly wage)
    if (phHours > 0) {
      addEarning({ code: 'PH', label: 'Public holiday worked (extra)', amount: phHours * rate, wageType: 'OW', detail: `${hrs(phHours)} × $${fmt(rate)}` });
    }
    if (paidLeaveDays > 0) {
      const dailyHours = emp.contract_hours_per_week ? emp.contract_hours_per_week / daysPerWeek : 0;
      if (!dailyHours) warnings.push('Paid leave taken but no contract hours per week set, so leave pay could not be calculated.');
      addEarning({
        code: 'LEAVEPAY',
        label: 'Paid leave',
        amount: paidLeaveDays * dailyHours * rate,
        wageType: 'OW',
        detail: `${paidLeaveDays} day(s) × ${hrs(dailyHours)} × $${fmt(rate)}`,
      });
    }
  }

  for (const [i, e] of (ov.extraEarnings ?? []).entries()) {
    if (e.amount) earnings.push({ code: `EXTRA_${i}`, label: e.label || 'Other earning', amount: money(e.amount), wageType: e.wageType, auto: false });
  }

  // ---- CPF ----
  const sum = (xs: { amount: number }[]) => money(xs.reduce((a, x) => a + x.amount, 0));
  const wageCuts = sum(deductions.filter((d) => d.reducesWages));
  const ow = Math.max(0, money(sum(earnings.filter((e) => e.wageType === 'OW')) - wageCuts));
  const aw = sum(earnings.filter((e) => e.wageType === 'AW'));
  const grossWages = money(ow + aw);

  if (emp.residency !== 'FOREIGNER' && !emp.dob) warnings.push('No date of birth: CPF assumed the 55-and-below rate.');
  const cpf = computeCpf({
    residency: emp.residency,
    prStart: emp.pr_start_date,
    prScheme: emp.pr_scheme,
    dob: emp.dob,
    year,
    month,
    ow,
    aw,
    ytdOwSubject: input.ytdOwSubject,
    ytdAwSubject: input.ytdAwSubject,
  });
  if (cpf.employee > 0) addDeduction({ code: 'CPF', label: "CPF (employee's share)", amount: cpf.employee, reducesWages: false });
  const shg = shgContribution(emp.shg_fund, grossWages);
  if (shg > 0) addDeduction({ code: 'SHG', label: `${emp.shg_fund} fund`, amount: shg, reducesWages: false });

  for (const [i, d] of (ov.extraDeductions ?? []).entries()) {
    if (d.amount) deductions.push({ code: `XDED_${i}`, label: d.label || 'Other deduction', amount: money(d.amount), reducesWages: false, auto: false });
  }

  const totalEarnings = sum(earnings);
  const totalDeductions = sum(deductions);
  const net = money(totalEarnings - totalDeductions);
  if (net < 0) warnings.push('Net pay is negative. Check the deductions.');
  const levy = sdl(grossWages);

  return {
    year,
    month,
    periodStart: monthStart,
    periodEnd: monthEnd,
    employee: {
      id: emp.id,
      full_name: emp.full_name,
      emp_code: emp.emp_code,
      job_title: emp.job_title,
      employment_type: emp.employment_type,
      nric_last4: emp.nric_last4,
    },
    earnings,
    deductions,
    hours: {
      worked: money(totalHours),
      normal: money(normalHours),
      ot: money(otHours),
      publicHoliday: money(phHours),
      restDay: money(restHours),
    },
    workingDays,
    daysPaid: Math.max(0, employedWorkingDays - unpaidDays),
    unpaidDays,
    paidLeaveDays,
    ow,
    aw,
    grossWages,
    totalEarnings,
    totalDeductions,
    net,
    cpf,
    shgFund: emp.shg_fund,
    shg,
    sdl: levy,
    employerCost: money(totalEarnings + cpf.employer + levy),
    remarks: ov.remarks,
    warnings,
  };
}
