'use client';

import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { Activity, Loader2, Lock } from 'lucide-react';

export function LoginForm() {
  const params = useSearchParams();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'Sign-in failed');
        return;
      }
      const next = params.get('next');
      // Only follow same-site relative paths.
      window.location.href = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center bg-ink-950 p-6">
      <form onSubmit={submit} className="card w-full max-w-sm p-6 space-y-5">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-accent/20 flex items-center justify-center">
            <Activity className="w-5 h-5 text-accent-soft" />
          </div>
          <div>
            <div className="text-white font-semibold leading-tight">ASH</div>
            <div className="text-[10px] uppercase tracking-widest text-slate-500">Alert Platform</div>
          </div>
        </div>
        <div>
          <label className="label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoFocus
            autoComplete="current-password"
            className="input w-full"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && <div className="text-sm text-bear">{error}</div>}
        <button type="submit" className="btn-primary w-full justify-center" disabled={pending || !password}>
          {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />} Sign in
        </button>
      </form>
    </div>
  );
}
