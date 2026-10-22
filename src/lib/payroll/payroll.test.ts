import { describe, expect, it } from 'vitest';
import { ageBand, computeCpf, type CpfInput } from './cpf';
import { countLeaveDays, partTimeFactor, statutoryAnnualLeave, statutorySickLeave } from './leave';
import { calculatePayslip, type PayrollInput } from './pay';
import { sdl, shgContribution } from './shg';
import { DEFAULT_PAYROLL_SETTINGS, type Employee, type LeaveRequest, type LeaveType, type Shift } from '../types';

const cpf = (p: Partial<CpfInput>) =>
  computeCpf({ residency: 'SC', prStart: null, prScheme: 'GG', dob: '1996-01-01', year: 2026, month: 10, ow: 0, aw: 0, ...p });

describe('CPF (2026 rates)', () => {
  it('SC aged 55 and below, $3,000', () => {
    expect(cpf({ ow: 3000 })).toMatchObject({ total: 1110, employee: 600, employer: 510 });
  });
  it('rounds total to nearest dollar and drops cents on the employee share', () => {
    // 37% × 2345.67 = 867.90 → 868; 20% × 2345.67 = 469.13 → 469
    expect(cpf({ ow: 2345.67 })).toMatchObject({ total: 868, employee: 469, employer: 399 });
  });
  it('caps OW at $8,000', () => {
    expect(cpf({ ow: 10000 })).toMatchObject({ owSubject: 8000, total: 2960, employee: 1600, employer: 1360 });
  });
  it('wage bands: ≤$50, ≤$500, ≤$750', () => {
    expect(cpf({ ow: 40 }).total).toBe(0);
    expect(cpf({ ow: 400 })).toMatchObject({ total: 68, employee: 0 });
    // 17% × 600 + 0.6 × 100 = 162; employee 60
    expect(cpf({ ow: 600 })).toMatchObject({ total: 162, employee: 60, employer: 102 });
  });
  it('senior worker rates', () => {
    expect(cpf({ ow: 3000, dob: '1969-05-10' })).toMatchObject({ ageBand: '55to60', total: 1020, employee: 540 });
    expect(cpf({ ow: 3000, dob: '1964-05-10' })).toMatchObject({ ageBand: '60to65', total: 750, employee: 375 });
    expect(cpf({ ow: 3000, dob: '1950-05-10' })).toMatchObject({ ageBand: 'gt70', total: 375, employee: 150 });
  });
  it('age band changes the month after the birthday', () => {
    expect(ageBand('1971-10-15', 2026, 10)).toBe('le55');
    expect(ageBand('1971-10-15', 2026, 11)).toBe('55to60');
    expect(ageBand('1971-09-30', 2026, 10)).toBe('55to60');
  });
  it('PR graduated rates by year of PR status', () => {
    expect(cpf({ residency: 'PR', prStart: '2026-03-01', ow: 3000 })).toMatchObject({ scheme: 'PR1_GG', total: 270, employee: 150 });
    expect(cpf({ residency: 'PR', prStart: '2025-03-01', ow: 3000 })).toMatchObject({ scheme: 'PR2_GG', total: 720, employee: 450 });
    expect(cpf({ residency: 'PR', prStart: '2024-03-01', ow: 3000 })).toMatchObject({ scheme: 'FULL', total: 1110 });
    expect(cpf({ residency: 'PR', prStart: '2026-03-01', prScheme: 'FG', ow: 3000 })).toMatchObject({ scheme: 'PR1_FG', total: 660, employee: 150 });
  });
  it('foreigners pay no CPF', () => {
    expect(cpf({ residency: 'FOREIGNER', ow: 5000 })).toMatchObject({ total: 0, employee: 0 });
  });
  it('additional wages within and above the AW ceiling', () => {
    expect(cpf({ ow: 5000, aw: 10000, ytdOwSubject: 45000 })).toMatchObject({ awSubject: 10000, total: 5550, employee: 3000 });
    expect(cpf({ month: 12, ow: 8000, aw: 20000, ytdOwSubject: 88000 })).toMatchObject({ awSubject: 6000 });
  });
});

describe('SHG and SDL', () => {
  it('fund tables', () => {
    expect(shgContribution('CDAC', 3000)).toBe(1);
    expect(shgContribution('MBMF', 2500)).toBe(6.5);
    expect(shgContribution('SINDA', 800)).toBe(1);
    expect(shgContribution('ECF', 12000)).toBe(20);
    expect(shgContribution('NONE', 3000)).toBe(0);
  });
  it('SDL min $2, max $11.25', () => {
    expect(sdl(500)).toBe(2);
    expect(sdl(3000)).toBe(7.5);
    expect(sdl(10000)).toBe(11.25);
  });
});

describe('Leave', () => {
  it('annual leave: pro-rated in the joining year, +1 per year to 14', () => {
    expect(statutoryAnnualLeave('2026-06-15', 2026)).toBe(4); // 7 × 6/12 = 3.5 → 4
    expect(statutoryAnnualLeave('2020-01-01', 2026)).toBe(13);
    expect(statutoryAnnualLeave('2015-01-01', 2026)).toBe(14);
    expect(statutoryAnnualLeave('2019-01-01', 2026, partTimeFactor('PT', 22))).toBe(7);
    expect(statutoryAnnualLeave('2027-01-01', 2026)).toBe(0);
  });
  it('sick leave by months of service', () => {
    expect(statutorySickLeave('2026-06-01', '2026-08-31')).toEqual({ outpatient: 0, hospitalisation: 0 });
    expect(statutorySickLeave('2026-06-01', '2026-09-01')).toEqual({ outpatient: 5, hospitalisation: 15 });
    expect(statutorySickLeave('2026-06-01', '2027-01-01')).toEqual({ outpatient: 14, hospitalisation: 60 });
  });
  it('counts working days, skipping rest days and public holidays', () => {
    const monFri = [1, 2, 3, 4, 5];
    expect(countLeaveDays('2026-10-19', '2026-10-25', false, monFri, new Set())).toBe(5);
    expect(countLeaveDays('2026-10-19', '2026-10-25', false, monFri, new Set(['2026-10-21']))).toBe(4);
    expect(countLeaveDays('2026-10-19', '2026-10-19', true, monFri, new Set())).toBe(0.5);
  });
});

const baseEmployee: Employee = {
  id: 'e1',
  emp_code: 'M001',
  full_name: 'Test Person',
  email: null,
  phone: null,
  job_title: null,
  outlet: null,
  color: null,
  employment_type: 'FT',
  monthly_basic: 3000,
  hourly_rate: null,
  fixed_allowance: 0,
  ot_eligible: false,
  work_days: [1, 2, 3, 4, 5],
  contract_hours_per_week: null,
  dob: '1996-01-01',
  residency: 'SC',
  pr_start_date: null,
  pr_scheme: 'GG',
  shg_fund: 'NONE',
  nric_last4: null,
  start_date: '2025-01-01',
  end_date: null,
  active: true,
  user_id: null,
};

const leaveTypes: LeaveType[] = [
  { code: 'AL', name: 'Annual', paid: true, default_days: null, track_balance: true, sort_order: 1 },
  { code: 'UNPAID', name: 'Unpaid', paid: false, default_days: null, track_balance: false, sort_order: 9 },
];

let shiftId = 0;
const shift = (date: string, start: string, end: string, breakMinutes = 60): Shift => ({
  id: `s${shiftId++}`,
  employee_id: 'e1',
  date,
  start_time: start,
  end_time: end,
  break_minutes: breakMinutes,
  actual_start: null,
  actual_end: null,
  actual_break_minutes: null,
  status: 'worked',
  day_type: 'auto',
  note: null,
});

const leave = (type: string, start: string, end: string): LeaveRequest => ({
  id: 'l1',
  employee_id: 'e1',
  leave_type: type,
  start_date: start,
  end_date: end,
  half_day: false,
  days: 0,
  reason: null,
  attachment_path: null,
  status: 'approved',
  hr_note: null,
  created_at: '',
});

const run = (p: Omit<Partial<PayrollInput>, 'employee'> & { employee?: Partial<Employee> }) =>
  calculatePayslip({
    year: 2026,
    month: 10,
    shifts: [],
    leaves: [],
    leaveTypes,
    holidays: new Set(['2026-12-25']),
    settings: DEFAULT_PAYROLL_SETTINGS,
    ...p,
    employee: { ...baseEmployee, ...p.employee },
  });

describe('Payslip', () => {
  it('full-timer, full month', () => {
    const r = run({});
    expect(r.workingDays).toBe(22); // Oct 2026, Mon–Fri
    expect(r.grossWages).toBe(3000);
    expect(r.cpf).toMatchObject({ employee: 600, employer: 510 });
    expect(r.net).toBe(2400);
  });
  it('SHG deduction', () => {
    expect(run({ employee: { shg_fund: 'CDAC' } }).net).toBe(2399);
  });
  it('unpaid leave reduces wages before CPF', () => {
    const r = run({ leaves: [leave('UNPAID', '2026-10-19', '2026-10-20')] });
    expect(r.unpaidDays).toBe(2);
    expect(r.deductions.find((d) => d.code === 'UNPAID')?.amount).toBe(272.73);
    expect(r.ow).toBe(2727.27);
    expect(r.cpf).toMatchObject({ total: 1009, employee: 545 });
    expect(r.net).toBe(2182.27);
  });
  it('paid leave does not reduce a full-timer’s pay', () => {
    expect(run({ leaves: [leave('AL', '2026-10-19', '2026-10-20')] }).net).toBe(2400);
  });
  it('incomplete month for a new joiner', () => {
    const r = run({ employee: { start_date: '2026-10-15' } });
    expect(r.deductions.find((d) => d.code === 'INCOMPLETE')?.amount).toBe(1363.64);
    expect(r.ow).toBe(1636.36);
  });
  it('full-timer OT at 1.5 × (12 × basic) / (52 × 44)', () => {
    const r = run({ employee: { monthly_basic: 2000, ot_eligible: true }, shifts: [shift('2026-10-21', '09:00', '20:00')] });
    expect(r.hours.ot).toBe(1);
    expect(r.earnings.find((e) => e.code === 'OT')?.amount).toBe(15.73);
  });
  it('full-timer rest day work', () => {
    const r = run({ employee: { monthly_basic: 2600, ot_eligible: true }, shifts: [shift('2026-10-24', '10:00', '19:00')] });
    // 8h on a Saturday: one day's pay (2600 × 12 / 260 = 120) and no OT (normal day is 8.8h)
    expect(r.earnings.find((e) => e.code === 'REST')?.amount).toBe(120);
    expect(r.hours.ot).toBe(0);
  });
  const pt: Partial<Employee> = { employment_type: 'PT', monthly_basic: null, hourly_rate: 14, ot_eligible: true, contract_hours_per_week: 28, work_days: [1, 3, 5, 6] };
  it('part-timer hourly wages, employer-only CPF under $500', () => {
    const shifts = ['2026-10-05', '2026-10-07', '2026-10-09', '2026-10-10'].map((d) => shift(d, '10:00', '18:00'));
    const r = run({ employee: pt, shifts });
    expect(r.hours.worked).toBe(28);
    expect(r.grossWages).toBe(392);
    expect(r.cpf).toMatchObject({ total: 67, employee: 0, employer: 67 });
    expect(r.net).toBe(392);
  });
  it('part-timer daily OT over 9 hours', () => {
    const r = run({ employee: pt, shifts: [shift('2026-10-05', '10:00', '22:00')] });
    expect(r.hours.ot).toBe(2);
    expect(r.earnings.find((e) => e.code === 'BASIC')?.amount).toBe(126);
    expect(r.earnings.find((e) => e.code === 'OT')?.amount).toBe(42);
  });
  it('part-timer public holiday extra pay', () => {
    const r = run({ month: 12, employee: pt, shifts: [shift('2026-12-25', '10:00', '18:00')] });
    expect(r.earnings.find((e) => e.code === 'PH')?.amount).toBe(98);
  });
  it('overrides: bonus as AW, reimbursement outside CPF, switched-off lines', () => {
    const r = run({
      overrides: {
        extraEarnings: [
          { label: 'Bonus', amount: 1000, wageType: 'AW' },
          { label: 'Transport claim', amount: 50, wageType: 'NONE' },
        ],
        extraDeductions: [{ label: 'Salary advance', amount: 100 }],
      },
    });
    expect(r.aw).toBe(1000);
    expect(r.grossWages).toBe(4000);
    expect(r.cpf).toMatchObject({ total: 1480, employee: 800 });
    expect(r.net).toBe(3000 + 1000 + 50 - 800 - 100);
    const noPh = run({ month: 12, employee: pt, shifts: [shift('2026-12-25', '10:00', '18:00')], overrides: { disabled: ['PH'] } });
    expect(noPh.earnings.find((e) => e.code === 'PH')).toBeUndefined();
  });
});
