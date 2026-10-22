import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';

export default function ChangePassword({ forced = false }: { forced?: boolean }) {
  const { refresh, signOut, session } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError('Use at least 8 characters.');
    if (password !== confirm) return setError("The passwords don't match.");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setBusy(false);
      return setError(error.message);
    }
    await supabase.rpc('password_changed');
    setBusy(false);
    setDone(true);
    setPassword('');
    setConfirm('');
    if (forced) await refresh();
  }

  const form = (
    <form className="card auth-card stack" onSubmit={submit}>
      <h2>{forced ? 'Set your own password' : 'Change password'}</h2>
      {forced && <p className="muted">You're signed in with a temporary password. Please choose a new one to continue.</p>}
      {error && <div className="alert error">{error}</div>}
      {done && !forced && <div className="alert ok">Password updated.</div>}
      <input type="email" autoComplete="username" value={session?.user.email ?? ''} readOnly hidden />
      <label className="field">
        New password
        <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </label>
      <label className="field">
        Confirm new password
        <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
      </label>
      <button className="btn btn-primary" disabled={busy}>
        {busy ? 'Saving…' : 'Save password'}
      </button>
      {forced && (
        <button type="button" className="btn btn-ghost" onClick={signOut}>
          Sign out
        </button>
      )}
    </form>
  );

  return forced ? <div className="auth-page">{form}</div> : form;
}
