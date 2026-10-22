// Supabase Edge Function: lets HR create logins for employees and reset their passwords.
// Creating users needs the service-role key, which must never be in the website code,
// so it lives here (Supabase injects SUPABASE_SERVICE_ROLE_KEY automatically).
//
// Deploy: Supabase dashboard → Edge Functions → Deploy a new function → name it "admin-users"
// and paste this file. Keep "Verify JWT" switched on.

import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  // Who is calling? Only HR may use this function.
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: caller, error: callerError } = await admin.auth.getUser(token);
  if (callerError || !caller.user) return json({ error: 'Not signed in' }, 401);
  const { data: profile } = await admin.from('profiles').select('role').eq('id', caller.user.id).single();
  if (profile?.role !== 'hr') return json({ error: 'Only HR can manage logins' }, 403);

  let body: Record<string, string>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid request' }, 400);
  }

  const validPassword = (p: unknown) => typeof p === 'string' && p.length >= 8;

  switch (body.action) {
    case 'create': {
      const { employee_id, email, password } = body;
      if (!employee_id || !email || !validPassword(password)) return json({ error: 'Employee, email and an 8+ character password are required' }, 400);
      const { data: emp } = await admin.from('employees').select('id, user_id').eq('id', employee_id).single();
      if (!emp) return json({ error: 'Employee not found' }, 404);
      if (emp.user_id) return json({ error: 'This employee already has a login' }, 409);

      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error || !data.user) return json({ error: error?.message ?? 'Could not create user' }, 400);
      // The on_auth_user_created trigger has already made the profile (role employee, must change password).
      const { error: linkError } = await admin.from('employees').update({ user_id: data.user.id, email }).eq('id', employee_id);
      if (linkError) {
        await admin.auth.admin.deleteUser(data.user.id);
        return json({ error: linkError.message }, 400);
      }
      return json({ user_id: data.user.id });
    }

    case 'reset_password': {
      const { user_id, password } = body;
      if (!user_id || !validPassword(password)) return json({ error: 'User and an 8+ character password are required' }, 400);
      const { error } = await admin.auth.admin.updateUserById(user_id, { password });
      if (error) return json({ error: error.message }, 400);
      await admin.from('profiles').update({ must_change_password: true }).eq('id', user_id);
      return json({ ok: true });
    }

    case 'delete': {
      const { user_id } = body;
      if (!user_id) return json({ error: 'User is required' }, 400);
      if (user_id === caller.user.id) return json({ error: "You can't remove your own login" }, 400);
      const { error } = await admin.auth.admin.deleteUser(user_id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    default:
      return json({ error: 'Unknown action' }, 400);
  }
});
