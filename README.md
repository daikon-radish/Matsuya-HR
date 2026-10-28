# Matsuya HR

A small HR portal for Matsuya Foods (Singapore): rostering, availability, timesheets, leave, and monthly payroll with CPF and printable payslips.

- **HR** manages employees, assigns shifts on a calendar, records or imports hours, approves leave, runs payroll and prints payslips. Most screens export to Excel.
- **Employees** see their shifts, set their availability, apply for leave (with an MC upload), and view or download their payslips.

It's a static React site (GitHub Pages) backed by Supabase (Postgres, logins and file storage), all on free tiers.

## One-time setup

### 1. Supabase

1. Create a free project at [supabase.com](https://supabase.com). Choose region **Southeast Asia (Singapore)**.
2. **SQL Editor → New query**: paste all of [`supabase/schema.sql`](supabase/schema.sql) and click **Run**. It creates the tables, the security rules (Row Level Security), the MC upload bucket, the leave types and the 2026–2027 public holidays. It's safe to run again after future changes.
3. **Authentication → Sign In / Providers**: turn **off** "Allow new users to sign up". Only HR creates logins.
4. **Edge Functions → Deploy a new function → Via editor**: name it `admin-users`, paste [`supabase/functions/admin-users/index.ts`](supabase/functions/admin-users/index.ts), and deploy. Leave JWT verification on. HR uses this to create employee logins and reset passwords.
   (Or with the CLI: `npx supabase functions deploy admin-users --project-ref <ref>`.)
5. **Create the first HR login**: go to **Authentication → Users → Add user → Create new user**, enter the HR email and a temporary password, and tick **Auto Confirm User**. Then run this in the SQL Editor:

   ```sql
   update public.profiles set role = 'hr' where email = '<hr email>';
   ```

   She'll be asked to choose her own password on first sign-in.

### 2. GitHub Pages

1. Push this folder to a GitHub repo, on the `main` branch.
2. Go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
3. Go to **Settings → Secrets and variables → Actions → Variables** and add:
   - `VITE_SUPABASE_URL`: from Supabase **Project Settings → API** (Project URL)
   - `VITE_SUPABASE_ANON_KEY`: the **anon / public** key from the same page
4. Re-run the **Deploy to GitHub Pages** workflow, or push a commit. The site will be at `https://<username>.github.io/<repo>/`.

Both values are designed to be public, so storing them as plain variables is fine. The database is protected by the security rules, not by hiding the key. **Never** put the `service_role` key in this repo.

The **Keep Supabase awake** workflow pings the database every 3 days, because free projects pause after a week of no use. GitHub stops scheduled workflows on repos with no commits for 60 days. If that happens, re-enable it from the Actions tab.

### 3. Local development

```bash
cp .env.example .env.local   # fill in the two values
npm install
npm run dev                  # http://localhost:5173
npm test                     # payroll/CPF unit tests
```

## How payroll is calculated

The logic lives in [`src/lib/payroll/`](src/lib/payroll/) and is covered by [`payroll.test.ts`](src/lib/payroll/payroll.test.ts).

| Item | Rule |
|---|---|
| Part-timers | Hours from timesheets × hourly rate. Same rate every day of the week. |
| Full-timers | Monthly basic + fixed allowance. |
| Overtime | Only for staff marked "Paid overtime". 1.5× for hours beyond 9 a day or 44 a week (Settings). Full-timer hourly rate = 12 × basic ÷ (52 × 44). Warns above 72 h/month. |
| Public holiday worked | An extra day's basic pay for full-timers. Part-timers get the hours worked paid again at the basic rate. HR can untick it when giving a day off in lieu. |
| Rest day worked | Full-timers with paid OT, rostered by HR (employer's request): one day's pay (up to half a normal day) or two days' pay; hours beyond a normal day are OT. If the employee asked to work that day, MOM's rate is half that: untick "Rest day worked" and add the amount as an earning. |
| Unpaid leave / joining or leaving mid-month | MOM formula: monthly gross × days not worked ÷ working days in the month. Reduces CPF wages. |
| Paid leave (part-timers) | Days × (contract hours per week ÷ work days per week) × rate. |
| CPF | CPF Board tables from 1 Jan 2026 for citizens and PRs (including 1st/2nd-year PR graduated rates), age bands, $8,000 OW ceiling, $102,000 annual ceiling for bonuses (AW), and CPF's rounding rules. Foreigners pay none. |
| SHG funds | CDAC / ECF / MBMF / SINDA by total wages, set per employee. |
| SDL | 0.25% of wages, min $2, max $11.25 (employer cost, shown in the Excel export). |

On each draft payslip HR can override OT hours or unpaid days, switch calculated items off, and add earnings (OW, AW bonus, or non-CPF claims), deductions and remarks. **Finalise** locks the month and makes the payslips visible to employees.

**For the first one or two months, run payroll alongside the current method and compare the CPF totals with CPF EZPay** before relying on it.

## Yearly upkeep

- **January:** CPF rates change. Senior-worker rates rise on 1 Jan 2027. Add a new entry to `RATE_TABLES` in [`cpfRates.ts`](src/lib/payroll/cpfRates.ts) (don't edit the 2026 one) and add a test.
- **Around June:** MOM announces next year's public holidays. Add them under **Settings → Public holidays**.
- **Monthly:** HR should click **Settings → Download full backup**. The free Supabase tier has no downloadable backups.

## Project layout

```
src/
  lib/payroll/     CPF, SHG, leave and payslip calculations (pure functions + tests)
  lib/             Supabase client, auth, dates, Excel helpers, availability logic
  components/      Shift editor, leave form, payslip document, availability editor
  pages/hr/        HR screens
  pages/me/        Employee screens
supabase/
  schema.sql       Tables, security rules, seed data
  functions/       admin-users Edge Function (create logins / reset passwords)
```
