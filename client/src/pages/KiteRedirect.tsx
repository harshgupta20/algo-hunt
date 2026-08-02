import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { api } from '../lib/api';

// Module-level so a StrictMode remount (dev) doesn't exchange the token twice.
const handledTokens = new Set<string>();

/**
 * Kite OAuth redirect landing (the app's registered Redirect URL,
 * e.g. http://localhost:5173/zerodhaRedirection). Reads the request_token from
 * the query, exchanges it for an access token via the server, and returns to
 * Settings — fully automatic, no manual paste.
 */
export function KiteRedirect() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [message, setMessage] = useState('Connecting to Kite…');

  useEffect(() => {
    const back = (q: string) => navigate(`/settings?${q}`, { replace: true });
    const status = params.get('status');
    const token = params.get('request_token');

    if (status && status !== 'success') return back('kite=error&message=' + encodeURIComponent('Login was cancelled'));
    if (!token) return back('kite=error&message=' + encodeURIComponent('Missing request_token in redirect'));
    if (handledTokens.has(token)) return; // already exchanged (StrictMode remount)
    handledTokens.add(token);

    api
      .kiteSubmitToken(token)
      .then(() => back('kite=connected'))
      .catch((e: Error) => {
        setMessage('Login failed — redirecting…');
        back('kite=error&message=' + encodeURIComponent(e.message));
      });
  }, [params, navigate]);

  return (
    <div className="flex h-full items-center justify-center bg-ink-950">
      <div className="flex flex-col items-center gap-3 text-slate-300">
        <Loader2 className="w-6 h-6 animate-spin text-accent-soft" />
        <span className="text-sm">{message}</span>
      </div>
    </div>
  );
}
