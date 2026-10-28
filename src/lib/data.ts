import { useCallback, useEffect, useState } from 'react';
import { must, supabase } from './supabase';
import {
  DEFAULT_PAYROLL_SETTINGS,
  type CompanySettings,
  type Employee,
  type Holiday,
  type LeaveType,
  type PayrollSettings,
} from './types';

/** Runs an async loader on mount / when deps change; exposes loading, error and reload. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fn()
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setError(null);
        }
      })
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}

export async function loadEmployees(activeOnly = false): Promise<Employee[]> {
  let q = supabase.from('employees').select('*').order('full_name');
  if (activeOnly) q = q.eq('active', true);
  return must(await q) as Employee[];
}

export async function loadHolidays(): Promise<Holiday[]> {
  return must(await supabase.from('holidays').select('*').order('date')) as Holiday[];
}

export async function loadLeaveTypes(): Promise<LeaveType[]> {
  return must(await supabase.from('leave_types').select('*').order('sort_order')) as LeaveType[];
}

export async function loadSettings(): Promise<{ company: CompanySettings; payroll: PayrollSettings }> {
  const rows = must(await supabase.from('settings').select('*')) as { key: string; value: unknown }[];
  const get = (k: string) => rows.find((r) => r.key === k)?.value as Record<string, unknown> | undefined;
  return {
    company: { name: 'Matsuya Foods', uen: '', address: '', ...(get('company') as Partial<CompanySettings>) },
    payroll: { ...DEFAULT_PAYROLL_SETTINGS, ...(get('payroll') as Partial<PayrollSettings>) },
  };
}

export function fmtMoney(n: number | null | undefined): string {
  return `$${(n ?? 0).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Postgres returns 'HH:MM:SS'; the UI works in 'HH:MM'. */
export function hhmm(t: string | null | undefined): string {
  return t ? t.slice(0, 5) : '';
}

const PALETTE = ['#2563eb', '#db2777', '#16a34a', '#ea580c', '#7c3aed', '#0891b2', '#ca8a04', '#dc2626', '#4f46e5', '#059669', '#9333ea', '#0d9488'];

export function employeeColor(e: Pick<Employee, 'id' | 'color'>): string {
  if (e.color) return e.color;
  let h = 0;
  for (const c of e.id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
