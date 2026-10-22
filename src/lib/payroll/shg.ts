// Self-Help Group fund deductions (employee-paid, collected by CPF Board), based on
// total wages for the month. Tables as published by CDAC, ECF, MUIS (MBMF) and SINDA.
// Employees can opt out of CDAC/ECF/SINDA by applying to the fund; MBMF opt-out goes via MUIS.

export type ShgFund = 'NONE' | 'CDAC' | 'ECF' | 'MBMF' | 'SINDA';

// [upper bound of total wages (inclusive), monthly contribution]
const TABLES: Record<Exclude<ShgFund, 'NONE'>, [number, number][]> = {
  CDAC: [[2000, 0.5], [3500, 1], [5000, 1.5], [7500, 2], [Infinity, 3]],
  ECF: [[1000, 2], [1500, 4], [2500, 6], [4000, 9], [7000, 12], [10000, 16], [Infinity, 20]],
  MBMF: [[1000, 3], [2000, 4.5], [3000, 6.5], [4000, 15], [6000, 19.5], [8000, 22], [10000, 24], [Infinity, 26]],
  SINDA: [[1000, 1], [1500, 3], [2500, 5], [4500, 7], [7500, 9], [10000, 12], [15000, 18], [Infinity, 30]],
};

export const SHG_LABELS: Record<ShgFund, string> = {
  NONE: 'None / opted out',
  CDAC: 'CDAC (Chinese)',
  ECF: 'ECF (Eurasian)',
  MBMF: 'MBMF (Muslim)',
  SINDA: 'SINDA (Indian)',
};

export function shgContribution(fund: ShgFund, totalWages: number): number {
  if (fund === 'NONE' || totalWages <= 0) return 0;
  const row = TABLES[fund].find(([upTo]) => totalWages <= upTo);
  return row ? row[1] : 0;
}

/** Skills Development Levy: 0.25% of the first $4,500 of total wages, min $2, max $11.25. Employer-paid. */
export function sdl(totalWages: number): number {
  if (totalWages <= 0) return 0;
  const levy = Math.max(2, Math.min(11.25, totalWages * 0.0025));
  return Math.round(levy * 100) / 100;
}
