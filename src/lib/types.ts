import type { PrScheme, Residency } from './payroll/cpf';
import type { ShgFund } from './payroll/shg';
import type { PayrollOverrides, PayslipResult } from './payroll/pay';

export type Role = 'hr' | 'employee';

export interface Profile {
  id: string;
  email: string;
  role: Role;
  must_change_password: boolean;
}

export interface Employee {
  id: string;
  emp_code: string | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  job_title: string | null;
  outlet: string | null;
  color: string | null;
  employment_type: 'FT' | 'PT';
  monthly_basic: number | null;
  hourly_rate: number | null;
  fixed_allowance: number;
  ot_eligible: boolean;
  /** 0 = Sunday … 6 = Saturday */
  work_days: number[];
  contract_hours_per_week: number | null;
  dob: string | null;
  residency: Residency;
  pr_start_date: string | null;
  pr_scheme: PrScheme;
  shg_fund: ShgFund;
  nric_last4: string | null;
  start_date: string;
  end_date: string | null;
  active: boolean;
  user_id: string | null;
}

export type DayType = 'auto' | 'normal' | 'rest_day' | 'public_holiday';

export interface Shift {
  id: string;
  employee_id: string;
  date: string;
  start_time: string;
  end_time: string;
  break_minutes: number;
  actual_start: string | null;
  actual_end: string | null;
  actual_break_minutes: number | null;
  status: 'scheduled' | 'worked' | 'absent';
  day_type: DayType;
  note: string | null;
}

export interface Availability {
  id: string;
  employee_id: string;
  /** Set for a weekly recurring slot (0 = Sunday) */
  weekday: number | null;
  /** Set for a one-off date */
  date: string | null;
  start_time: string | null;
  end_time: string | null;
  available: boolean;
  note: string | null;
}

export interface LeaveType {
  code: string;
  name: string;
  paid: boolean;
  default_days: number | null;
  track_balance: boolean;
  sort_order: number;
}

export interface LeaveRequest {
  id: string;
  employee_id: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  half_day: boolean;
  days: number;
  reason: string | null;
  attachment_path: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  hr_note: string | null;
  created_at: string;
}

export interface LeaveEntitlement {
  id: string;
  employee_id: string;
  year: number;
  leave_type: string;
  days: number;
}

export interface Holiday {
  date: string;
  name: string;
}

export interface PayrollRun {
  id: string;
  year: number;
  month: number;
  status: 'draft' | 'finalized';
  pay_date: string | null;
  finalized_at: string | null;
}

export interface Payslip {
  id: string;
  run_id: string;
  employee_id: string;
  year: number;
  month: number;
  status: 'draft' | 'finalized';
  overrides: PayrollOverrides;
  result: PayslipResult;
  gross: number;
  net: number;
  cpf_employee: number;
  cpf_employer: number;
  ow_subject: number;
  aw_subject: number;
}

export interface CompanySettings {
  name: string;
  uen: string;
  address: string;
}

export interface PayrollSettings {
  ot_multiplier: number;
  ot_daily_threshold: number;
  ot_weekly_threshold: number;
  pay_day: number;
}

export const DEFAULT_PAYROLL_SETTINGS: PayrollSettings = {
  ot_multiplier: 1.5,
  ot_daily_threshold: 9,
  ot_weekly_threshold: 44,
  pay_day: 7,
};
