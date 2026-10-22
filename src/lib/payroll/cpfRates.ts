// CPF contribution rates for private-sector employees from 1 January 2026.
// Source: CPF Board, "CPF Contribution Rate Table from 1 January 2026" (Tables 1–5).
// https://www.cpf.gov.sg/employer/employer-obligations/how-much-cpf-contributions-to-pay
//
// UPDATE EVERY JANUARY: senior-worker rates for ages 55–65 rise again on 1 Jan 2027.
// Add a new entry to RATE_TABLES with the new effective month rather than editing
// the 2026 numbers, so payslips for earlier months still compute correctly.

export type CpfScheme = 'FULL' | 'PR1_GG' | 'PR2_GG' | 'PR1_FG' | 'PR2_FG';
export type AgeBand = 'le55' | '55to60' | '60to65' | '65to70' | 'gt70';

export interface CpfRate {
  /** Total rate (employer only) when total wages are > $50 and ≤ $500 */
  low: number;
  /** Employee phase-in factor on (TW − 500) when total wages are > $500 and ≤ $750 */
  phase: number;
  /** Total (employer + employee) rate when wages > $750 */
  total: number;
  /** Employee rate when wages > $750 */
  employee: number;
}

type RateTable = Record<CpfScheme, Record<AgeBand, CpfRate>>;

const r = (low: number, phase: number, total: number, employee: number): CpfRate => ({ low, phase, total, employee });

const RATES_2026: RateTable = {
  // Table 1: Singapore Citizens, and PRs from the 3rd year (or 1st/2nd year at full/full rates)
  FULL: {
    le55: r(0.17, 0.6, 0.37, 0.2),
    '55to60': r(0.16, 0.54, 0.34, 0.18),
    '60to65': r(0.125, 0.375, 0.25, 0.125),
    '65to70': r(0.09, 0.225, 0.165, 0.075),
    gt70: r(0.075, 0.15, 0.125, 0.05),
  },
  // Table 2: PR 1st year, graduated employer & employee (G/G)
  PR1_GG: {
    le55: r(0.04, 0.15, 0.09, 0.05),
    '55to60': r(0.04, 0.15, 0.09, 0.05),
    '60to65': r(0.035, 0.15, 0.085, 0.05),
    '65to70': r(0.035, 0.15, 0.085, 0.05),
    gt70: r(0.035, 0.15, 0.085, 0.05),
  },
  // Table 3: PR 2nd year, G/G
  PR2_GG: {
    le55: r(0.09, 0.45, 0.24, 0.15),
    '55to60': r(0.06, 0.375, 0.185, 0.125),
    '60to65': r(0.035, 0.225, 0.11, 0.075),
    '65to70': r(0.035, 0.15, 0.085, 0.05),
    gt70: r(0.035, 0.15, 0.085, 0.05),
  },
  // Table 4: PR 1st year, full employer & graduated employee (F/G)
  PR1_FG: {
    le55: r(0.17, 0.15, 0.22, 0.05),
    '55to60': r(0.16, 0.15, 0.21, 0.05),
    '60to65': r(0.125, 0.15, 0.175, 0.05),
    '65to70': r(0.09, 0.15, 0.14, 0.05),
    gt70: r(0.075, 0.15, 0.125, 0.05),
  },
  // Table 5: PR 2nd year, F/G
  PR2_FG: {
    le55: r(0.17, 0.45, 0.32, 0.15),
    '55to60': r(0.16, 0.375, 0.285, 0.125),
    '60to65': r(0.125, 0.225, 0.2, 0.075),
    '65to70': r(0.09, 0.15, 0.14, 0.05),
    gt70: r(0.075, 0.15, 0.125, 0.05),
  },
};

interface RatePeriod {
  /** First month the table applies, 'YYYY-MM' */
  from: string;
  rates: RateTable;
  owCeiling: number;
  annualCeiling: number;
}

const RATE_TABLES: RatePeriod[] = [
  { from: '2026-01', rates: RATES_2026, owCeiling: 8000, annualCeiling: 102000 },
];

export function ratesFor(year: number, month: number): RatePeriod {
  const key = `${year}-${String(month).padStart(2, '0')}`;
  const applicable = RATE_TABLES.filter((t) => t.from <= key);
  // Months before the earliest table fall back to it; the app is only used from 2026.
  return applicable.length ? applicable[applicable.length - 1] : RATE_TABLES[0];
}
