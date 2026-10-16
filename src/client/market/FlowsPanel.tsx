'use client';

/** Money flow: FII / DII cash-market activity and the day's bulk & block deals. */
import { useState } from 'react';
import clsx from 'clsx';
import type { Deal, Flow } from '@/shared/market/types';
import { InfoTip, Tooltip } from '../components/Tooltip';
import { Section, Segmented } from '../components/ui';
import { FlowColumns } from './charts';
import { dirClass, fmtCrore, fmtInt, fmtPrice, fmtRupees, shortDay } from './format';
import { M } from './help';
import { Skeleton } from './parts';

export function FlowsPanel({ flows, deals, onPick }: { flows: { latest: Flow | null; history: Flow[] } | undefined; deals: Deal[] | undefined; onPick: (s: string) => void }) {
  const [kind, setKind] = useState<'all' | 'block' | 'bulk'>('all');
  const list = (deals ?? []).filter((d) => kind === 'all' || d.kind === kind).slice(0, 40);
  const latest = flows?.latest;
  const history = [...(flows?.history ?? [])].reverse();
  return (
    <Section title="Money flow" help={M.flows}>
      {!flows ? (
        <Skeleton className="h-40" />
      ) : !latest ? (
        <p className="py-6 text-center text-xs text-slate-500">NSE hasn’t published FII / DII data yet.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {(['fii', 'dii'] as const).map((k) => {
            const s = latest[k];
            return (
              <div key={k} className="rounded-lg bg-ink-850 p-3">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">
                  {k === 'fii' ? 'FII / FPI' : 'DII'} · {shortDay(latest.date)}
                </div>
                <div className={clsx('mt-0.5 text-xl font-semibold tabular-nums', dirClass(s.net))}>{fmtCrore(s.net)}</div>
                <div className="text-[11px] tabular-nums text-slate-500">
                  bought {fmtCrore(s.buy, false)} · sold {fmtCrore(s.sell, false)}
                </div>
                {history.length > 1 && (
                  <div className="mt-2">
                    <FlowColumns days={history.map((h) => ({ date: h.date, net: h[k].net }))} label={`${k.toUpperCase()} net flows by day`} />
                    <div className="mt-1 text-[9px] text-slate-600">last {history.length} days</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div className="mt-5">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-300">Bulk & block deals</span>
          <InfoTip content={M.deals} />
          <div className="ml-auto">
            <Segmented
              label="Deal type"
              value={kind}
              onChange={setKind}
              options={[
                { value: 'all', label: 'All', help: M.deals },
                { value: 'block', label: 'Block', help: { title: 'Block deals', body: 'Single trades of at least ₹10 Cr in NSE’s block window.' } },
                { value: 'bulk', label: 'Bulk', help: { title: 'Bulk deals', body: 'One client trading more than 0.5% of a company’s shares in a day.' } },
              ]}
            />
          </div>
        </div>
        {!deals ? (
          <Skeleton className="h-40" />
        ) : list.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-500">No deals reported today.</p>
        ) : (
          <div className="max-h-[300px] overflow-y-auto">
            <table className="w-full text-[11px]">
              <tbody>
                {list.map((d, i) => (
                  <tr key={`${d.symbol}-${d.client}-${i}`} className="cursor-pointer border-t border-ink-700/40 hover:bg-ink-800/60" onClick={() => onPick(d.symbol)}>
                    <td className="py-1.5 pr-2">
                      <span className={clsx('rounded px-1.5 py-0.5 text-[10px] font-semibold', d.side === 'BUY' ? 'bg-bull/15 text-bull' : 'bg-bear/15 text-bear')}>{d.side}</span>
                    </td>
                    <td className="pr-2">
                      <div className="font-medium text-slate-200">{d.symbol}</div>
                      <Tooltip content={{ title: d.client, body: `${d.kind === 'block' ? 'Block' : 'Bulk'} deal: ${d.side === 'BUY' ? 'bought' : 'sold'} ${fmtInt(d.qty)} shares of ${d.name} at ₹${fmtPrice(d.price)} (${fmtRupees(d.value)}).` }}>
                        <div className="max-w-[220px] cursor-help truncate text-[10px] text-slate-500">{d.client}</div>
                      </Tooltip>
                    </td>
                    <td className="text-right tabular-nums text-slate-300">{fmtRupees(d.value)}</td>
                    <td className="pl-2 text-right text-[10px] uppercase text-slate-500">{d.kind}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Section>
  );
}
