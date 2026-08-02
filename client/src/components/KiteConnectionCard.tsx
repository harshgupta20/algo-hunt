import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Link2, Loader2, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import type { KiteAuthState } from '@ash/shared';
import { api } from '../lib/api';
import { useKiteStatus } from '../hooks/useKiteStatus';
import { Card } from './ui';

const STATE_META: Record<KiteAuthState, { label: string; text: string; dot: string }> = {
  connected: { label: 'Connected', text: 'text-bull', dot: 'bg-bull' },
  connecting: { label: 'Connecting…', text: 'text-warn', dot: 'bg-warn animate-pulse' },
  'needs-login': { label: 'Not connected', text: 'text-warn', dot: 'bg-warn' },
  error: { label: 'Error', text: 'text-bear', dot: 'bg-bear' },
  disabled: { label: 'Disabled', text: 'text-slate-500', dot: 'bg-slate-600' },
};

export function KiteConnectionCard() {
  const { data } = useKiteStatus();
  const [params, setParams] = useSearchParams();
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; msg: string } | null>(null);

  useEffect(() => {
    const kite = params.get('kite');
    if (!kite) return;
    if (kite === 'connected') setNotice({ kind: 'ok', msg: 'Kite connected — live market data is active.' });
    else setNotice({ kind: 'error', msg: params.get('message') ?? 'Kite login failed.' });
    params.delete('kite');
    params.delete('message');
    setParams(params, { replace: true });
  }, [params, setParams]);

  if (!data) return null;

  const connect = () => {
    window.location.href = api.kiteLoginUrl;
  };

  if (!data.enabled) {
    return (
      <Card className="mb-6">
        <h2 className="text-sm font-semibold text-slate-300 mb-2">Broker Connection</h2>
        <p className="text-sm text-slate-400">
          Running on <span className="text-slate-200">simulated market data (mock)</span>. To connect Zerodha Kite,
          set <code className="text-accent-soft">MARKET_PROVIDER=kite</code> in <code>.env</code> (with your API key +
          secret) and restart.
        </p>
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

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm">
          <span className={clsx('w-2.5 h-2.5 rounded-full', meta.dot)} />
          <span className={clsx('font-medium', meta.text)}>{meta.label}</span>
          {data.state === 'connecting' && <Loader2 className="w-4 h-4 animate-spin text-warn" />}
        </div>
        <button className={connected ? 'btn-ghost text-xs' : 'btn-primary text-xs'} onClick={connect}>
          {connected ? <RefreshCw className="w-4 h-4" /> : <Link2 className="w-4 h-4" />}
          {connected ? 'Reconnect' : 'Connect Kite'}
        </button>
      </div>

      {data.lastError && (
        <div className="mt-2 flex items-start gap-2 text-xs text-slate-400">
          <AlertTriangle className="w-3.5 h-3.5 text-warn shrink-0 mt-0.5" />
          <span>{data.lastError}</span>
        </div>
      )}
      {connected && (
        <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
          <CheckCircle2 className="w-3.5 h-3.5 text-bull" />
          Live feed active. Kite tokens expire each trading day — reconnect each morning.
        </div>
      )}

      <p className="mt-3 pt-3 border-t border-ink-700/60 text-[11px] text-slate-500 leading-relaxed">
        Login is one click — you're sent to Kite, then returned here automatically. Your Kite app's
        <span className="text-slate-400"> Redirect URL</span> must be
        <code className="text-accent-soft"> http://localhost:5173/zerodhaRedirection</code>.
      </p>
    </Card>
  );
}
