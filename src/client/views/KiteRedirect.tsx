'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '../lib/api';
import { BrandLoader } from '../components/loaders';

// Module-level so a StrictMode remount (dev) doesn't exchange the token twice.
const handledTokens = new Set<string>();

/**
 * Kite OAuth redirect landing (the app's registered Redirect URL,
 * https://<your-domain>/zerodhaRedirection or /redirect/zerodha). Reads the request_token from the
 * query, exchanges it for an access token via the server, and returns to
 * Settings — fully automatic, no manual paste.
 */
export function KiteRedirect() {
  const params = useSearchParams();
  const router = useRouter();
  const [message, setMessage] = useState('Connecting to Kite…');

  useEffect(() => {
    const back = (q: string) => router.replace(`/settings?${q}`);
    const status = params.get('status');
    const token = params.get('request_token');

    if (status && status !== 'success') return back('kite=error&message=' + encodeURIComponent('Login was cancelled'));
    if (!token) return back('kite=error&message=' + encodeURIComponent('Missing request_token in redirect'));
    if (handledTokens.has(token)) return; // already exchanged (StrictMode remount)
    handledTokens.add(token);

    setMessage('Connecting to Kite…');
    api
      .kiteSubmitToken(token)
      .then(() => back('kite=connected'))
      .catch((e: Error) => {
        setMessage('Login failed — redirecting…');
        back('kite=error&message=' + encodeURIComponent(e.message));
      });
  }, [params, router]);

  return (
    <div className="flex h-full items-center justify-center bg-ink-950">
      <BrandLoader size="lg" label={message} />
    </div>
  );
}
