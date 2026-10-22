import { addDays, monthRange } from '../dates';
import { loadEmployees, loadHolidays, loadLeaveTypes, loadSettings } from '../data';
import { must, supabase } from '../supabase';
import type { Employee, LeaveRequest, LeaveType, PayrollRun, PayrollSettings, Payslip, Shift } from '../types';
import { calculatePayslip, type PayrollOverrides, type PayslipResult } from './pay';

export interface RunContext {
  year: number;
  month: number;
  employees: Employee[];
  shifts: Shift[];
  leaves: LeaveRequest[];
  leaveTypes: LeaveType[];
  holidays: Set<string>;
  settings: PayrollSettings;
  /** CPF-able wages already finalised earlier this year, per employee */
  ytd: Map<string, { ow: number; aw: number }>;
}

/** Everything needed to calculate a month's payslips, fetched in a handful of queries. */
export async function loadRunContext(year: number, month: number): Promise<RunContext> {
  const [start, end] = monthRange(year, month);
  const [employees, holidays, leaveTypes, settings, shifts, leaves, earlier] = await Promise.all([
    loadEmployees(),
    loadHolidays(),
    loadLeaveTypes(),
    loadSettings(),
    supabase.from('shifts').select('*').gte('date', start).lte('date', end),
    supabase.from('leave_requests').select('*').eq('status', 'approved').lte('start_date', end).gte('end_date', start),
    supabase.from('payslips').select('employee_id, ow_subject, aw_subject').eq('year', year).lt('month', month).eq('status', 'finalized'),
  ]);
  const ytd = new Map<string, { ow: number; aw: number }>();
  for (const p of must(earlier) as { employee_id: string; ow_subject: number; aw_subject: number }[]) {
    const t = ytd.get(p.employee_id) ?? { ow: 0, aw: 0 };
    t.ow += Number(p.ow_subject);
    t.aw += Number(p.aw_subject);
    ytd.set(p.employee_id, t);
  }
  return {
    year,
    month,
    employees,
    shifts: must(shifts) as Shift[],
    leaves: must(leaves) as LeaveRequest[],
    leaveTypes,
    holidays: new Set(holidays.map((h) => h.date)),
    settings: settings.payroll,
    ytd,
  };
}

/** Employees who should be on this month's payroll: employed at some point during the month. */
export function payrollEmployees(ctx: RunContext): Employee[] {
  const [start, end] = monthRange(ctx.year, ctx.month);
  return ctx.employees.filter((e) => e.start_date <= end && (!e.end_date || e.end_date >= start) && (e.active || (e.end_date && e.end_date >= start)));
}

export function calculateFor(ctx: RunContext, emp: Employee, overrides: PayrollOverrides): PayslipResult {
  const ytd = ctx.ytd.get(emp.id);
  return calculatePayslip({
    year: ctx.year,
    month: ctx.month,
    employee: emp,
    shifts: ctx.shifts.filter((s) => s.employee_id === emp.id),
    leaves: ctx.leaves.filter((l) => l.employee_id === emp.id),
    leaveTypes: ctx.leaveTypes,
    holidays: ctx.holidays,
    settings: ctx.settings,
    ytdOwSubject: ytd?.ow ?? 0,
    ytdAwSubject: ytd?.aw ?? 0,
    overrides,
  });
}

export function payslipRow(run: PayrollRun, emp: Employee, overrides: PayrollOverrides, result: PayslipResult) {
  return {
    run_id: run.id,
    employee_id: emp.id,
    year: run.year,
    month: run.month,
    status: run.status,
    overrides,
    result,
    gross: result.grossWages,
    net: result.net,
    cpf_employee: result.cpf.employee,
    cpf_employer: result.cpf.employer,
    ow_subject: result.cpf.owSubject,
    aw_subject: result.cpf.awSubject,
    updated_at: new Date().toISOString(),
  };
}

/** (Re)calculate every draft payslip in a run, keeping HR's adjustments, and add anyone missing. */
export async function recalculateRun(run: PayrollRun, existing: Payslip[]): Promise<void> {
  const ctx = await loadRunContext(run.year, run.month);
  const byEmp = new Map(existing.map((p) => [p.employee_id, p]));
  const rows = [];
  const wanted = payrollEmployees(ctx);
  // Also keep employees HR added by hand who no longer match (e.g. paid after leaving)
  for (const p of existing) if (!wanted.some((e) => e.id === p.employee_id)) {
    const e = ctx.employees.find((x) => x.id === p.employee_id);
    if (e) wanted.push(e);
  }
  for (const emp of wanted) {
    const overrides = byEmp.get(emp.id)?.overrides ?? {};
    rows.push(payslipRow(run, emp, overrides, calculateFor(ctx, emp, overrides)));
  }
  if (rows.length) must(await supabase.from('payslips').upsert(rows, { onConflict: 'run_id,employee_id' }));
}

export function defaultPayDate(year: number, month: number, payDay: number): string {
  const [, end] = monthRange(year, month);
  return addDays(end, Math.max(1, Math.min(payDay, 7)));
}
