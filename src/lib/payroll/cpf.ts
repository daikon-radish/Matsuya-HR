import { addDays, monthRange, monthsBetween, yearsBetween, type YMD } from '../dates';
import { ratesFor, type AgeBand, type CpfScheme } from './cpfRates';

export type Residency = 'SC' | 'PR' | 'FOREIGNER';
/** GG = graduated/graduated, FG = full employer/graduated employee, FF = full/full */
export type PrScheme = 'GG' | 'FG' | 'FF';

export interface CpfResult {
  scheme: CpfScheme | null;
  ageBand: AgeBand | null;
  /** OW actually subject to CPF (after the OW ceiling) */
  owSubject: number;
  /** AW actually subject to CPF (after the AW ceiling) */
  awSubject: number;
  total: number;
  employee: number;
  employer: number;
}

// Small epsilon so 0.2 × 3000 = 599.9999… still floors to 600.
const EPS = 1e-6;
const roundDollar = (x: number) => Math.floor(x + 0.5 + EPS);
const floorDollar = (x: number) => Math.floor(x + EPS);

/**
 * New rates apply from the first day of the month AFTER the 55th/60th/65th/70th birthday,
 * so the band is decided by the employee's age on the last day of the previous month.
 */
export function ageBand(dob: YMD, year: number, month: number): AgeBand {
  const [first] = monthRange(year, month);
  const age = yearsBetween(dob, addDays(first, -1));
  if (age < 55) return 'le55';
  if (age < 60) return '55to60';
  if (age < 65) return '60to65';
  if (age < 70) return '65to70';
  return 'gt70';
}

export function cpfScheme(residency: Residency, prStart: YMD | null, prScheme: PrScheme, year: number, month: number): CpfScheme | null {
  if (residency === 'FOREIGNER') return null;
  if (residency === 'SC' || !prStart || prScheme === 'FF') return 'FULL';
  const [first] = monthRange(year, month);
  const months = monthsBetween(prStart, first);
  if (months < 12) return prScheme === 'FG' ? 'PR1_FG' : 'PR1_GG';
  if (months < 24) return prScheme === 'FG' ? 'PR2_FG' : 'PR2_GG';
  return 'FULL';
}

export interface CpfInput {
  residency: Residency;
  prStart: YMD | null;
  prScheme: PrScheme;
  dob: YMD | null;
  year: number;
  month: number;
  /** Ordinary wages for the month (before ceiling) */
  ow: number;
  /** Additional wages for the month, e.g. bonus */
  aw: number;
  /** OW subject to CPF earlier in the calendar year (for the AW ceiling) */
  ytdOwSubject?: number;
  /** AW subject to CPF earlier in the calendar year */
  ytdAwSubject?: number;
}

export function computeCpf(input: CpfInput): CpfResult {
  const scheme = cpfScheme(input.residency, input.prStart, input.prScheme, input.year, input.month);
  const none: CpfResult = { scheme, ageBand: null, owSubject: 0, awSubject: 0, total: 0, employee: 0, employer: 0 };
  if (!scheme) return none;
  // Without a date of birth we assume the 55-and-below band; the payroll screen warns about this.
  const band = input.dob ? ageBand(input.dob, input.year, input.month) : 'le55';
  const period = ratesFor(input.year, input.month);
  const rate = period.rates[scheme][band];

  const ow = Math.max(0, input.ow);
  const aw = Math.max(0, input.aw);
  const owSubject = Math.min(ow, period.owCeiling);
  // AW ceiling = annual ceiling − total OW subject to CPF for the year. We only know OW
  // up to this month, which matches CPF's treatment for AW paid in December or on leaving;
  // for bonuses paid mid-year CPF expects an estimate, so the result may need a year-end adjustment.
  const awCeiling = Math.max(0, period.annualCeiling - (input.ytdOwSubject ?? 0) - owSubject);
  const awSubject = Math.min(aw, Math.max(0, awCeiling - (input.ytdAwSubject ?? 0)));
  const tw = ow + aw;

  let total: number;
  let employee: number;
  if (tw <= 50) {
    total = 0;
    employee = 0;
  } else if (tw <= 500) {
    total = roundDollar(rate.low * tw);
    employee = 0;
  } else if (tw <= 750) {
    total = roundDollar(rate.low * tw + rate.phase * (tw - 500));
    employee = floorDollar(rate.phase * (tw - 500));
  } else {
    total = roundDollar(rate.total * owSubject + rate.total * awSubject);
    employee = floorDollar(rate.employee * owSubject + rate.employee * awSubject);
  }
  return { scheme, ageBand: band, owSubject, awSubject, total, employee, employer: total - employee };
}

export const SCHEME_LABELS: Record<CpfScheme, string> = {
  FULL: 'SC / PR 3rd yr+',
  PR1_GG: 'PR 1st yr (G/G)',
  PR2_GG: 'PR 2nd yr (G/G)',
  PR1_FG: 'PR 1st yr (F/G)',
  PR2_FG: 'PR 2nd yr (F/G)',
};

export const AGE_BAND_LABELS: Record<AgeBand, string> = {
  le55: '55 & below',
  '55to60': 'Above 55–60',
  '60to65': 'Above 60–65',
  '65to70': 'Above 65–70',
  gt70: 'Above 70',
};
