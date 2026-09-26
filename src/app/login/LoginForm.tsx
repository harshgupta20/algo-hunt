'use client';

import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { Lock } from 'lucide-react';
import { Logo } from '@/client/components/Logo';
import { Tooltip } from '@/client/components/Tooltip';
import { InlineSpinner } from '@/client/components/loaders';

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
      <form onSubmit={submit} className="card w-full max-w-sm p-6 pt-7 space-y-5 relative overflow-hidden">
        <div aria-hidden className="bg-accent absolute inset-x-0 top-0 h-1.5" />
        <Logo height={40} />
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
        <Tooltip content={{ title: 'Sign in', body: 'Unlock the dashboard on this browser for 30 days.', note: 'The password is the APP_PASSWORD set on the server.' }} className="w-full">
          <button type="submit" className="btn-primary w-full justify-center" disabled={pending || !password}>
            {pending ? <InlineSpinner /> : <Lock className="w-4 h-4" />} Sign in
          </button>
        </Tooltip>
      </form>
    </div>
  );
}
