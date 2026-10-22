import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setError(error.message === 'Invalid login credentials' ? 'Wrong email or password.' : error.message);
  }

  return (
    <div className="auth-page">
      <form className="card auth-card stack" onSubmit={submit}>
        <div className="brand">
          <span className="brand-mark" style={{ color: '#fff' }}>M</span> Mastuya HR
        </div>
        {error && <div className="alert error">{error}</div>}
        <label className="field">
          Email
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          Password
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="muted small" style={{ textAlign: 'center' }}>
          Forgot your password? Ask HR to reset it.
        </p>
      </form>
    </div>
  );
}
