'use client';

/**
 * Live feed (streaming worker) health for the V2 dashboard: state, contracts
 * streamed, accuracy today and the last candle closes it processed.
 */
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Radio } from 'lucide-react';
import type { LiveState } from '@/shared/v2';
import { TIMEFRAME } from '@/shared/v2';
import { Tooltip } from '../components/Tooltip';
import { Badge } from '../components/ui';
import { v2Api } from './api';
import { Section } from './components';
import { istStamp, istStampIso } from './format';
import { H } from './help';
import { Skeleton } from '../components/loaders';

const STATE: Record<LiveState, { label: string; tone: 'bull' | 'warn' | 'accent' | 'default' }> = {
  LIVE: { label: 'Live', tone: 'bull' },
  WARMING_UP: { label: 'Warming up', tone: 'accent' },
  DEGRADED: { label: 'Degraded', tone: 'warn' },
  WAITING_LOGIN: { label: 'Waiting for Kite login', tone: 'warn' },
  STARTING: { label: 'Starting', tone: 'accent' },
  STOPPED: { label: 'Stopped', tone: 'default' },
};

const secs = (ms: number | undefined) => (ms === undefined ? '…' : `${(ms / 1000).toFixed(1)} s`);
const n = (v: number) => v.toLocaleString('en-IN');

function Stat({ label, value, hint, help }: { label: string; value: ReactNode; hint?: string; help: Parameters<typeof Tooltip>[0]['content'] }) {
  return (
    <Tooltip content={help} className="flex">
      <div className="flex-1 rounded-lg border border-ink-700/60 bg-ink-850 px-3 py-2">
        <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
        <p className="text-sm font-semibold text-fg tabular-nums">{value}</p>
        {hint && <p className="text-[11px] text-slate-500">{hint}</p>}
      </div>
    </Tooltip>
  );
}

export function LiveCard() {
  const q = useQuery({ queryKey: ['v2-live'], queryFn: v2Api.live, refetchInterval: 20_000 });
  const info = q.data;
  const s = info?.status;
  const online = info?.health.online ?? false;
  const badge = !s ? (
    <Badge>Not running</Badge>
  ) : online ? (
    <Tooltip content={H.live.state}>
      <span>
        <Badge tone={STATE[s.state].tone}>{STATE[s.state].label}</Badge>
      </span>
    </Tooltip>
  ) : (
    <Tooltip content={H.live.offline}>
      <span>
        <Badge tone={s.state === 'STOPPED' ? 'default' : 'warn'}>{s.state === 'STOPPED' ? 'Stopped' : 'Offline'}</Badge>
      </span>
    </Tooltip>
  );

  return (
    <Section title="Live feed" help={H.live.card} actions={badge}>
      {q.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-3 w-1/3 opacity-70" />
        </div>
      ) : !s ? (
        <Tooltip content={H.live.notRunning}>
          <p className="text-xs text-slate-400 inline-flex items-center gap-2">
            <Radio className="w-4 h-4 text-slate-500" /> Not running — it starts with the app (<code className="text-slate-200">npm start</code>) for instant, verified alerts. The per-minute scanner covers your connections meanwhile.
          </p>
        </Tooltip>
      ) : (
        <div className="flex flex-col gap-3">
          <p className={clsx('text-xs', online ? 'text-slate-300' : 'text-warn')}>
            {online ? s.detail : `${s.state === 'STOPPED' ? 'Stopped' : 'No heartbeat'} since ${istStampIso(s.heartbeatAt)} — the backup scanner checks your connections.`}
            <span className="text-slate-500"> · started {istStampIso(s.startedAt)}</span>
          </p>
          {online && s.state !== 'WAITING_LOGIN' && s.state !== 'STARTING' && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
              <Stat label="Contracts" value={`${n(s.contracts.subscribed)} / ${n(s.contracts.capacity)}`} hint={`${n(s.contracts.needed)} in use · ${n(s.contracts.buffer)} nearby strikes`} help={H.live.contracts} />
              <Stat
                label="Kite stream"
                value={`${s.sockets.filter((x) => x.state === 'OPEN').length} of ${s.sockets.length} open`}
                hint={`${n(s.ticks.perSecond)} ticks/s${s.warmup.total > s.warmup.done ? ` · history ${n(s.warmup.done)}/${n(s.warmup.total)}` : ''}`}
                help={H.live.stream}
              />
              <Stat label="Checked on Kite today" value={`${n(s.today.checked)}`} hint={`${n(s.today.corrected)} corrected · ${n(s.today.unverified)} unverified`} help={H.live.today} />
              <Stat label="Alerts today" value={n(s.today.alerts)} hint={`${n(s.today.candles)} candle close${s.today.candles === 1 ? '' : 's'} processed`} help={H.live.today} />
            </div>
          )}
          {s.connections.uncovered.length > 0 && (
            <Tooltip content={H.live.uncovered}>
              <p className="text-xs text-warn">{s.connections.uncovered.length} connection(s) don’t fit Kite’s contract limit — the backup scanner checks them.</p>
            </Tooltip>
          )}
          {s.lastCandles.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-[10px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="py-1 pr-3">
                      <Tooltip content={H.live.candles}>
                        <span>Candle</span>
                      </Tooltip>
                    </th>
                    <th className="py-1 pr-3 text-right">Units</th>
                    <th className="py-1 pr-3 text-right">
                      <Tooltip content={H.live.decided}>
                        <span>Decided in</span>
                      </Tooltip>
                    </th>
                    <th className="py-1 pr-3 text-right">
                      <Tooltip content={H.live.today}>
                        <span>Checked · corrected</span>
                      </Tooltip>
                    </th>
                    <th className="py-1 pr-3 text-right">
                      <Tooltip content={H.live.verified}>
                        <span>Kite check done</span>
                      </Tooltip>
                    </th>
                    <th className="py-1 text-right">Alerts</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-700/40">
                  {s.lastCandles.slice(0, 8).map((c) => (
                    <tr key={`${c.market}|${c.timeframe}|${c.candle}`}>
                      <td className="py-1 pr-3 text-slate-300">
                        {c.market} · {TIMEFRAME[c.timeframe].label} · {istStamp(c.candle)}
                      </td>
                      <td className="py-1 pr-3 text-right tabular-nums">{n(c.units)}</td>
                      <td className="py-1 pr-3 text-right tabular-nums">{secs(c.evaluatedMs)}</td>
                      <td className="py-1 pr-3 text-right tabular-nums">
                        {n(c.checked)} · <span className={c.corrected ? 'text-warn' : ''}>{n(c.corrected)}</span>
                        {c.unverified > 0 && <span className="text-warn"> · {n(c.unverified)} unverified</span>}
                      </td>
                      <td className="py-1 pr-3 text-right tabular-nums">{c.checked ? secs(c.confirmedMs) : '—'}</td>
                      <td className="py-1 text-right tabular-nums">{n(c.alerts)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {online && s.errors.length > 0 && (
            <Tooltip content={H.live.errors}>
              <div className="text-[11px] text-slate-400">
                {s.errors.slice(0, 3).map((e) => (
                  <p key={e.at + e.message}>
                    <span className="text-warn">•</span> {istStampIso(e.at).slice(7)} {e.message}
                  </p>
                ))}
              </div>
            </Tooltip>
          )}
        </div>
      )}
    </Section>
  );
}
