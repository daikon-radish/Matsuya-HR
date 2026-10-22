import { todayYMD } from './dates';
import { partTimeFactor, statutoryAnnualLeave, statutorySickLeave } from './payroll/leave';
import type { Employee, LeaveEntitlement, LeaveRequest, LeaveType } from './types';

export interface Balance {
  code: string;
  name: string;
  entitlement: number | null;
  /** True when HR has set the number for this year rather than using the statutory default */
  custom: boolean;
  used: number;
  pending: number;
  remaining: number | null;
}

/** Statutory or default entitlement for a leave type when HR hasn't set one. */
export function defaultEntitlement(emp: Employee, type: LeaveType, year: number): number | null {
  const factor = partTimeFactor(emp.employment_type, emp.contract_hours_per_week);
  const yearEnd = `${year}-12-31`;
  const today = todayYMD();
  const asOf = today < yearEnd ? today : yearEnd;
  if (type.code === 'AL') return statutoryAnnualLeave(emp.start_date, year, factor);
  if (type.code === 'MC') return statutorySickLeave(emp.start_date, asOf, factor).outpatient;
  if (type.code === 'HOSP') return statutorySickLeave(emp.start_date, asOf, factor).hospitalisation;
  return type.default_days;
}

export function computeBalances(
  emp: Employee,
  year: number,
  types: LeaveType[],
  entitlements: LeaveEntitlement[],
  requests: LeaveRequest[],
): Balance[] {
  const inYear = requests.filter((r) => r.employee_id === emp.id && r.start_date.startsWith(String(year)));
  const sumDays = (code: string, status: LeaveRequest['status']) =>
    inYear.filter((r) => r.leave_type === code && r.status === status).reduce((a, r) => a + Number(r.days), 0);

  return types
    .filter((t) => t.track_balance)
    .map((t) => {
      const row = entitlements.find((e) => e.employee_id === emp.id && e.year === year && e.leave_type === t.code);
      const entitlement = row ? Number(row.days) : defaultEntitlement(emp, t, year);
      let used = sumDays(t.code, 'approved');
      let pending = sumDays(t.code, 'pending');
      // Under the Employment Act, outpatient sick leave counts toward the hospitalisation total.
      if (t.code === 'HOSP') {
        used += sumDays('MC', 'approved');
        pending += sumDays('MC', 'pending');
      }
      return {
        code: t.code,
        name: t.name,
        entitlement,
        custom: Boolean(row),
        used,
        pending,
        remaining: entitlement == null ? null : entitlement - used,
      };
    });
}
