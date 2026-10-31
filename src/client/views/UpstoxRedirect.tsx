'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '../lib/api';
import { BrandLoader } from '../components/loaders';

// Module-level so a StrictMode remount (dev) doesn't send the one-time code twice.
const handledCodes = new Set<string>();

/**
 * Upstox login redirect landing (/redirect/upstox): sends the code + state to the server, which exchanges them
 * for an access token, then returns to V2 → Options backtest.
 */
export function UpstoxRedirect() {
  const params = useSearchParams();
  const router = useRouter();
  const [message, setMessage] = useState('Connecting to Upstox…');

  useEffect(() => {
    const back = (q: string) => router.replace(`/v2?tab=options&${q}`);
    const code = params.get('code');
    const state = params.get('state');
    const error = params.get('error') ?? params.get('error_description');

    if (error) return back('upstox=error&message=' + encodeURIComponent(`Upstox login was not completed (${error})`));
    if (!code || !state) return back('upstox=error&message=' + encodeURIComponent('Missing code in the Upstox redirect'));
    if (handledCodes.has(code)) return;
    handledCodes.add(code);

    api
      .upstoxSubmitCode(code, state)
      .then(() => back('upstox=connected'))
      .catch((e: Error) => {
        setMessage('Login failed — redirecting…');
        back('upstox=error&message=' + encodeURIComponent(e.message));
      });
  }, [params, router]);

  return (
    <div className="flex h-full items-center justify-center bg-ink-950">
      <BrandLoader size="lg" label={message} />
    </div>
  );
}
