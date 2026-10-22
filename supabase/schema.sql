-- Mastuya HR: database schema, security rules and seed data.
-- Run once in Supabase → SQL Editor → New query → paste → Run.
-- Safe to re-run: tables use IF NOT EXISTS and policies are dropped/recreated.

create extension if not exists pgcrypto;

-- ============================================================
-- Tables
-- ============================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  role text not null default 'employee' check (role in ('hr', 'employee')),
  must_change_password boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  emp_code text unique,
  full_name text not null,
  email text,
  phone text,
  job_title text,
  outlet text,
  color text,
  employment_type text not null default 'FT' check (employment_type in ('FT', 'PT')),
  monthly_basic numeric(10, 2),
  hourly_rate numeric(8, 2),
  fixed_allowance numeric(10, 2) not null default 0,
  ot_eligible boolean not null default true,
  work_days smallint[] not null default '{1,2,3,4,5}',
  contract_hours_per_week numeric(5, 2),
  dob date,
  residency text not null default 'SC' check (residency in ('SC', 'PR', 'FOREIGNER')),
  pr_start_date date,
  pr_scheme text not null default 'GG' check (pr_scheme in ('GG', 'FG', 'FF')),
  shg_fund text not null default 'NONE' check (shg_fund in ('NONE', 'CDAC', 'ECF', 'MBMF', 'SINDA')),
  nric_last4 text check (nric_last4 is null or char_length(nric_last4) <= 4),
  start_date date not null default current_date,
  end_date date,
  active boolean not null default true,
  user_id uuid unique references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.availability (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete cascade,
  weekday smallint check (weekday between 0 and 6),
  date date,
  start_time time,
  end_time time,
  available boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  check ((weekday is null) <> (date is null))
);
create index if not exists availability_employee_idx on public.availability (employee_id);

create table if not exists public.shifts (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete cascade,
  date date not null,
  start_time time not null,
  end_time time not null,
  break_minutes integer not null default 0,
  actual_start time,
  actual_end time,
  actual_break_minutes integer,
  status text not null default 'scheduled' check (status in ('scheduled', 'worked', 'absent')),
  day_type text not null default 'auto' check (day_type in ('auto', 'normal', 'rest_day', 'public_holiday')),
  note text,
  created_at timestamptz not null default now()
);
create index if not exists shifts_date_idx on public.shifts (date);
create index if not exists shifts_employee_date_idx on public.shifts (employee_id, date);

create table if not exists public.holidays (
  date date primary key,
  name text not null
);

create table if not exists public.leave_types (
  code text primary key,
  name text not null,
  paid boolean not null default true,
  default_days numeric(5, 1),
  track_balance boolean not null default true,
  sort_order integer not null default 0
);

create table if not exists public.leave_entitlements (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete cascade,
  year integer not null,
  leave_type text not null references public.leave_types (code) on update cascade,
  days numeric(5, 1) not null,
  unique (employee_id, year, leave_type)
);

create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete cascade,
  leave_type text not null references public.leave_types (code) on update cascade,
  start_date date not null,
  end_date date not null,
  half_day boolean not null default false,
  days numeric(5, 1) not null default 0,
  reason text,
  attachment_path text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  hr_note text,
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create index if not exists leave_requests_employee_idx on public.leave_requests (employee_id, start_date);

create table if not exists public.settings (
  key text primary key,
  value jsonb not null
);

create table if not exists public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  year integer not null,
  month integer not null check (month between 1 and 12),
  status text not null default 'draft' check (status in ('draft', 'finalized')),
  pay_date date,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  unique (year, month)
);

create table if not exists public.payslips (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.payroll_runs (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  year integer not null,
  month integer not null,
  status text not null default 'draft' check (status in ('draft', 'finalized')),
  overrides jsonb not null default '{}',
  result jsonb not null,
  gross numeric(12, 2) not null default 0,
  net numeric(12, 2) not null default 0,
  cpf_employee numeric(12, 2) not null default 0,
  cpf_employer numeric(12, 2) not null default 0,
  ow_subject numeric(12, 2) not null default 0,
  aw_subject numeric(12, 2) not null default 0,
  updated_at timestamptz not null default now(),
  unique (run_id, employee_id)
);
create index if not exists payslips_employee_idx on public.payslips (employee_id, year, month);

-- ============================================================
-- Helper functions
-- ============================================================

create or replace function public.is_hr()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'hr');
$$;

create or replace function public.my_employee_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.employees where user_id = auth.uid() limit 1;
$$;

-- Every new login gets a profile (role 'employee' until HR promotes it).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Called by the app after the user sets their own password.
create or replace function public.password_changed()
returns void language sql security definer set search_path = public as $$
  update public.profiles set must_change_password = false where id = auth.uid();
$$;

-- Leave days are always computed by the database (the employee's work days, minus public holidays),
-- so the number on a request can't be edited by hand.
create or replace function public.compute_leave_days()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  wd smallint[];
  n numeric;
begin
  select work_days into wd from public.employees where id = new.employee_id;
  select count(*) into n
  from generate_series(new.start_date, new.end_date, interval '1 day') as d
  where extract(dow from d)::smallint = any (coalesce(wd, '{1,2,3,4,5}'))
    and d::date not in (select date from public.holidays);
  if new.half_day and new.start_date = new.end_date then
    n := n * 0.5;
  end if;
  new.days := n;
  return new;
end;
$$;
drop trigger if exists leave_days on public.leave_requests;
create trigger leave_days before insert or update of start_date, end_date, half_day, employee_id
  on public.leave_requests for each row execute function public.compute_leave_days();

-- Employees may only cancel their own pending requests, not approve them.
create or replace function public.guard_leave_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_hr() then
    if old.status <> 'pending' or new.status not in ('pending', 'cancelled') then
      raise exception 'Only HR can change a request once it has been decided';
    end if;
    new.hr_note := old.hr_note;
  end if;
  return new;
end;
$$;
drop trigger if exists leave_guard on public.leave_requests;
create trigger leave_guard before update on public.leave_requests
  for each row execute function public.guard_leave_update();

-- Keep-alive endpoint for the scheduled GitHub Action (free projects pause after 7 idle days).
create or replace function public.ping()
returns timestamptz language sql stable as $$ select now(); $$;
grant execute on function public.ping() to anon;

-- ============================================================
-- API access (signed-in users only; RLS below decides which rows)
-- ============================================================

-- Explicit grants, so this works with "Automatically expose new tables" switched off.
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
-- The admin-users Edge Function uses the service role (it bypasses RLS but still needs table privileges).
grant all on all tables in schema public to service_role;
revoke all on all tables in schema public from anon;
grant execute on function public.is_hr(), public.my_employee_id(), public.password_changed() to authenticated;

-- ============================================================
-- Row Level Security
-- ============================================================

alter table public.profiles enable row level security;
alter table public.employees enable row level security;
alter table public.availability enable row level security;
alter table public.shifts enable row level security;
alter table public.holidays enable row level security;
alter table public.leave_types enable row level security;
alter table public.leave_entitlements enable row level security;
alter table public.leave_requests enable row level security;
alter table public.settings enable row level security;
alter table public.payroll_runs enable row level security;
alter table public.payslips enable row level security;

do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- profiles: see your own; HR sees and edits all
create policy profiles_select on public.profiles for select to authenticated using (id = auth.uid() or public.is_hr());
create policy profiles_hr_update on public.profiles for update to authenticated using (public.is_hr()) with check (public.is_hr());

-- employees: see your own record; HR manages all
create policy employees_select on public.employees for select to authenticated using (public.is_hr() or user_id = auth.uid());
create policy employees_hr_write on public.employees for all to authenticated using (public.is_hr()) with check (public.is_hr());

-- availability: employees manage their own; HR manages all
create policy availability_rw on public.availability for all to authenticated
  using (public.is_hr() or employee_id = public.my_employee_id())
  with check (public.is_hr() or employee_id = public.my_employee_id());

-- shifts: employees see their own; HR manages all
create policy shifts_select on public.shifts for select to authenticated using (public.is_hr() or employee_id = public.my_employee_id());
create policy shifts_hr_write on public.shifts for all to authenticated using (public.is_hr()) with check (public.is_hr());

-- reference data: everyone signed in can read; HR edits
create policy holidays_select on public.holidays for select to authenticated using (true);
create policy holidays_hr_write on public.holidays for all to authenticated using (public.is_hr()) with check (public.is_hr());
create policy leave_types_select on public.leave_types for select to authenticated using (true);
create policy leave_types_hr_write on public.leave_types for all to authenticated using (public.is_hr()) with check (public.is_hr());
create policy settings_select on public.settings for select to authenticated using (true);
create policy settings_hr_write on public.settings for all to authenticated using (public.is_hr()) with check (public.is_hr());

-- leave entitlements: see your own; HR manages
create policy entitlements_select on public.leave_entitlements for select to authenticated using (public.is_hr() or employee_id = public.my_employee_id());
create policy entitlements_hr_write on public.leave_entitlements for all to authenticated using (public.is_hr()) with check (public.is_hr());

-- leave requests: employees apply for and cancel their own pending requests; HR decides
create policy leave_select on public.leave_requests for select to authenticated using (public.is_hr() or employee_id = public.my_employee_id());
create policy leave_insert on public.leave_requests for insert to authenticated
  with check (public.is_hr() or (employee_id = public.my_employee_id() and status = 'pending'));
create policy leave_update on public.leave_requests for update to authenticated
  using (public.is_hr() or employee_id = public.my_employee_id())
  with check (public.is_hr() or employee_id = public.my_employee_id());
create policy leave_hr_delete on public.leave_requests for delete to authenticated using (public.is_hr());

-- payroll: HR manages; runs only hold month/status/pay date, so everyone can read them (for the payment date on payslips);
-- employees see only their own finalised payslips
create policy runs_select on public.payroll_runs for select to authenticated using (true);
create policy runs_hr on public.payroll_runs for all to authenticated using (public.is_hr()) with check (public.is_hr());
create policy payslips_select on public.payslips for select to authenticated
  using (public.is_hr() or (employee_id = public.my_employee_id() and status = 'finalized'));
create policy payslips_hr_write on public.payslips for all to authenticated using (public.is_hr()) with check (public.is_hr());

-- ============================================================
-- Storage: MC / leave attachments, one folder per employee id
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('leave-attachments', 'leave-attachments', false, 5242880)
on conflict (id) do nothing;

drop policy if exists leave_files_select on storage.objects;
drop policy if exists leave_files_insert on storage.objects;
drop policy if exists leave_files_delete on storage.objects;
create policy leave_files_select on storage.objects for select to authenticated
  using (bucket_id = 'leave-attachments' and (public.is_hr() or (storage.foldername(name))[1] = public.my_employee_id()::text));
create policy leave_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'leave-attachments' and (public.is_hr() or (storage.foldername(name))[1] = public.my_employee_id()::text));
create policy leave_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'leave-attachments' and (public.is_hr() or (storage.foldername(name))[1] = public.my_employee_id()::text));

-- ============================================================
-- Seed data (edit in the app under Settings)
-- ============================================================

insert into public.leave_types (code, name, paid, default_days, track_balance, sort_order) values
  ('AL', 'Annual leave', true, null, true, 1),
  ('MC', 'Sick leave (outpatient)', true, null, true, 2),
  ('HOSP', 'Hospitalisation leave', true, null, true, 3),
  ('CHILDCARE', 'Childcare leave', true, 0, true, 4),
  ('COMPASSIONATE', 'Compassionate leave', true, 0, false, 5),
  ('OIL', 'Off in lieu', true, 0, true, 6),
  ('UNPAID', 'Unpaid leave', false, null, false, 9)
on conflict (code) do nothing;

-- Singapore public holidays (MOM). In-lieu Mondays are listed for holidays falling on a Sunday.
insert into public.holidays (date, name) values
  ('2026-01-01', 'New Year''s Day'),
  ('2026-02-17', 'Chinese New Year'),
  ('2026-02-18', 'Chinese New Year (2nd day)'),
  ('2026-03-21', 'Hari Raya Puasa'),
  ('2026-04-03', 'Good Friday'),
  ('2026-05-01', 'Labour Day'),
  ('2026-05-27', 'Hari Raya Haji'),
  ('2026-05-31', 'Vesak Day'),
  ('2026-06-01', 'Vesak Day (in lieu)'),
  ('2026-08-09', 'National Day'),
  ('2026-08-10', 'National Day (in lieu)'),
  ('2026-11-08', 'Deepavali'),
  ('2026-11-09', 'Deepavali (in lieu)'),
  ('2026-12-25', 'Christmas Day'),
  ('2027-01-01', 'New Year''s Day'),
  ('2027-02-06', 'Chinese New Year'),
  ('2027-02-07', 'Chinese New Year (2nd day)'),
  ('2027-02-08', 'Chinese New Year (in lieu)'),
  ('2027-03-10', 'Hari Raya Puasa'),
  ('2027-03-26', 'Good Friday'),
  ('2027-05-01', 'Labour Day'),
  ('2027-05-17', 'Hari Raya Haji'),
  ('2027-05-20', 'Vesak Day'),
  ('2027-08-09', 'National Day'),
  ('2027-10-28', 'Deepavali'),
  ('2027-12-25', 'Christmas Day')
on conflict (date) do nothing;

insert into public.settings (key, value) values
  ('company', '{"name": "Mastuya Foods", "uen": "", "address": ""}'),
  ('payroll', '{"ot_multiplier": 1.5, "ot_daily_threshold": 9, "ot_weekly_threshold": 44, "pay_day": 7}')
on conflict (key) do nothing;
