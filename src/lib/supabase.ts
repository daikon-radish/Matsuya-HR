import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isConfigured = Boolean(url && anonKey);

// The anon key is public by design; Row Level Security in supabase/schema.sql protects the data.
export const supabase = createClient(url || 'http://localhost', anonKey || 'missing', {
  auth: { persistSession: true, autoRefreshToken: true },
});

/** Throws the Supabase error so callers can show it, otherwise returns data. */
export function must<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

export async function callAdminUsers(body: Record<string, string>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke('admin-users', { body });
  if (error) {
    // The function returns { error } with a non-2xx status; surface its message.
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      const payload = await ctx.json().catch(() => null);
      if (payload?.error) throw new Error(payload.error);
    }
    throw new Error(error.message);
  }
  return data;
}
