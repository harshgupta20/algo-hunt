'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Database, Link2, Loader2, LogOut, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import type { KiteAuthState } from '@ash/shared';
import { api } from '../lib/api';
import { fmtTime } from '../lib/format';
import { useKiteStatus } from '../hooks/useKiteStatus';
import { Card } from './ui';

const STATE_META: Record<KiteAuthState, { label: string; text: string; dot: string }> = {
  connected: { label: 'Connected', text: 'text-bull', dot: 'bg-bull' },
  connecting: { label: 'Connecting…', text: 'text-warn', dot: 'bg-warn animate-pulse' },
  'needs-login': { label: 'Not connected', text: 'text-warn', dot: 'bg-warn' },
  error: { label: 'Error', text: 'text-bear', dot: 'bg-bear' },
  disabled: { label: 'Not configured', text: 'text-bear', dot: 'bg-bear' },
};

export function KiteConnectionCard() {
  const qc = useQueryClient();
  const { data } = useKiteStatus();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; msg: string } | null>(null);
  const [origin, setOrigin] = useState('');

  const instruments = useQuery({
    queryKey: ['kite-instruments'],
    queryFn: api.kiteInstruments,
    enabled: data?.enabled === true,
  });
  const sync = useMutation({
    mutationFn: api.kiteSyncInstruments,
    onSuccess: (r) => {
      setNotice({ kind: 'ok', msg: `Instrument master refreshed (${r.count.toLocaleString()} contracts).` });
      void qc.invalidateQueries({ queryKey: ['kite-instruments'] });
      void qc.invalidateQueries({ queryKey: ['underlyings'] });
    },
    onError: (e: Error) => setNotice({ kind: 'error', msg: e.message }),
  });
  const logout = useMutation({
    mutationFn: api.kiteLogout,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['kite-status'] }),
  });

  useEffect(() => setOrigin(window.location.origin), []);

  useEffect(() => {
    const kite = params.get('kite');
    if (!kite) return;
    if (kite === 'connected') setNotice({ kind: 'ok', msg: 'Kite connected — live monitoring and the analyzer are using real market data.' });
    else setNotice({ kind: 'error', msg: params.get('message') ?? 'Kite login failed.' });
    void qc.invalidateQueries({ queryKey: ['kite-instruments'] });
    router.replace(pathname);
  }, [params, router, pathname, qc]);

  if (!data) return null;

  const connect = () => {
    window.location.href = api.kiteLoginUrl;
  };

  if (!data.enabled) {
    return (
      <Card className="mb-6">
        <h2 className="text-sm font-semibold text-slate-300 mb-2">Broker Connection · Zerodha Kite</h2>
        <div className="flex items-start gap-2 text-sm text-slate-400">
          <AlertTriangle className="w-4 h-4 text-bear shrink-0 mt-0.5" />
          <span>
            Kite Connect credentials are missing. Set <code className="text-accent-soft">KITE_API_KEY</code> and{' '}
            <code className="text-accent-soft">KITE_API_SECRET</code> in your environment (Vercel → Project → Settings →
            Environment Variables) and redeploy.
          </span>
        </div>
      </Card>
    );
  }

  const meta = STATE_META[data.state];
  const connected = data.state === 'connected';

  return (
    <Card className="mb-6">
      <h2 className="text-sm font-semibold text-slate-300 mb-3">Broker Connection · Zerodha Kite</h2>

      {notice && (
        <div
          className={clsx(
            'mb-3 rounded-lg px-3 py-2 text-sm border',
            notice.kind === 'ok' ? 'border-bull/30 bg-bull/10 text-bull' : 'border-bear/30 bg-bear/10 text-bear',
          )}
        >
          {notice.msg}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <span className={clsx('w-2.5 h-2.5 rounded-full', meta.dot)} />
          <span className={clsx('font-medium', meta.text)}>{meta.label}</span>
          {data.state === 'connecting' && <Loader2 className="w-4 h-4 animate-spin text-warn" />}
          {connected && data.userName && (
            <span className="text-slate-400">
              · {data.userName} {data.userId ? `(${data.userId})` : ''}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          {connected && (
            <button className="btn-ghost text-xs" onClick={() => logout.mutate()} disabled={logout.isPending}>
              <LogOut className="w-4 h-4" /> Disconnect
            </button>
          )}
          <button className={connected ? 'btn-ghost text-xs' : 'btn-primary text-xs'} onClick={connect}>
            {connected ? <RefreshCw className="w-4 h-4" /> : <Link2 className="w-4 h-4" />}
            {connected ? 'Reconnect' : 'Connect Kite'}
          </button>
        </div>
      </div>

      {data.lastError && !connected && (
        <div className="mt-2 flex items-start gap-2 text-xs text-slate-400">
          <AlertTriangle className="w-3.5 h-3.5 text-warn shrink-0 mt-0.5" />
          <span>{data.lastError}</span>
        </div>
      )}
      {connected && (
        <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
          <CheckCircle2 className="w-3.5 h-3.5 text-bull" />
          Session valid{data.expiresAt ? ` until ${fmtTime(data.expiresAt)}` : ''}. Kite resets access tokens every
          morning (~6:00 AM IST) — reconnect once per trading day.
        </div>
      )}

      {connected && (
        <div className="mt-3 flex items-center justify-between gap-3 text-xs text-slate-400">
          <span className="flex items-center gap-2">
            <Database className="w-3.5 h-3.5 text-slate-500" />
            Instrument master:{' '}
            {instruments.data
              ? `${instruments.data.count.toLocaleString()} contracts${instruments.data.syncedAt ? ` · synced ${fmtTime(instruments.data.syncedAt)}` : ''}`
              : '…'}
          </span>
          <button className="btn-ghost text-xs" onClick={() => sync.mutate()} disabled={sync.isPending}>
            {sync.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Refresh
          </button>
        </div>
      )}

      <p className="mt-3 pt-3 border-t border-ink-700/60 text-[11px] text-slate-500 leading-relaxed">
        Login is one click — you&apos;re sent to Kite, then returned here automatically. In your Kite Connect app
        (developers.kite.trade) set the <span className="text-slate-400">Redirect URL</span> to
        <code className="text-accent-soft break-all"> {origin || 'https://<your-domain>'}/zerodhaRedirection</code>
        {' '}(or <code className="text-accent-soft break-all">{origin || 'https://<your-domain>'}/redirect/zerodha</code>).
      </p>
    </Card>
  );
}
