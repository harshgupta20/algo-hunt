'use client';

/**
 * WHAT + WHERE: product, target type, expiry, CE/PE, strikes and reference
 * future — plus the live list of contracts this resolves to.
 */
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import type { ExpirySelector, OptionType, ReferenceSelector, StrikeSelector, Universe } from '@/shared/mcx';
import { MCX2_EXPIRY_MODES, MCX2_GROUP_LABEL, MCX2_STRIKE_MODES } from '@/shared/mcx';
import { InfoTip, Tooltip } from '../../components/Tooltip';
import { IconButton, Spinner } from '../../components/ui';
import { mcxApi, type ProductRow } from '../api';
import { Cell, InstrumentTag, Segmented, Toggle } from '../components';
import { fmtNum } from '../format';
import { H } from '../help';

function ExpiryPicker({ value, onChange, expiries, label }: { value: ExpirySelector | ReferenceSelector; onChange: (e: ExpirySelector) => void; expiries: string[]; label: string }) {
  return (
    <>
      <select
        aria-label={label}
        className="input py-1 text-xs"
        value={value.mode}
        onChange={(e) => {
          const mode = e.target.value as ExpirySelector['mode'];
          onChange(mode === 'SPECIFIC' ? { mode, date: expiries[0] ?? '' } : { mode });
        }}
      >
        {MCX2_EXPIRY_MODES.map((m) => (
          <option key={m.mode} value={m.mode}>
            {m.label}
          </option>
        ))}
      </select>
      {value.mode === 'SPECIFIC' && (
        <select aria-label={`${label} date`} className="input py-1 text-xs" value={value.date} onChange={(e) => onChange({ mode: 'SPECIFIC', date: e.target.value })}>
          {!expiries.includes(value.date) && <option value={value.date}>{value.date || 'Pick a date'} (not listed)</option>}
          {expiries.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      )}
    </>
  );
}

function StrikePicker({ value, onChange }: { value: StrikeSelector; onChange: (s: StrikeSelector) => void }) {
  const setMode = (mode: StrikeSelector['mode']) => {
    if (mode === 'ATM_OFFSETS') onChange({ mode, offsets: [0] });
    else if (mode === 'ITM' || mode === 'OTM') onChange({ mode, count: 2 });
    else if (mode === 'SPECIFIC') onChange({ mode, strikes: [] });
    else if (mode === 'RANGE') onChange({ mode, from: 0, to: 0 });
    else onChange({ mode: 'ALL' });
  };
  const atmN = value.mode === 'ATM_OFFSETS' ? Math.max(...value.offsets.map(Math.abs)) : 0;
  const contiguous = value.mode === 'ATM_OFFSETS' && value.offsets.length === 2 * atmN + 1;
  return (
    <>
      <select aria-label="Strike selection" className="input py-1 text-xs" value={value.mode} onChange={(e) => setMode(e.target.value as StrikeSelector['mode'])}>
        {MCX2_STRIKE_MODES.map((m) => (
          <option key={m.mode} value={m.mode}>
            {m.label}
          </option>
        ))}
      </select>
      {value.mode === 'ATM_OFFSETS' && (
        <>
          <Tooltip content={{ title: 'ATM ± N', body: 'Quick pick: the ATM strike plus N listed strikes on each side.' }}>
            <select
              aria-label="ATM plus minus N"
              className="input py-1 text-xs"
              value={contiguous ? String(atmN) : 'custom'}
              onChange={(e) => {
                if (e.target.value === 'custom') return;
                const n = Number(e.target.value);
                onChange({ mode: 'ATM_OFFSETS', offsets: Array.from({ length: 2 * n + 1 }, (_, i) => i - n) });
              }}
            >
              {[0, 1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? 'ATM only' : `ATM ± ${n}`}
                </option>
              ))}
              {!contiguous && <option value="custom">Custom offsets</option>}
            </select>
          </Tooltip>
          <Tooltip content={H.editor.offsets}>
            <input
              aria-label="ATM offsets"
              className="input py-1 text-xs w-36 font-mono"
              defaultValue={value.offsets.join(', ')}
              key={value.offsets.join(',')}
              onBlur={(e) => {
                const offsets = e.target.value
                  .split(/[,\s]+/)
                  .filter(Boolean)
                  .map(Number)
                  .filter((n) => Number.isInteger(n));
                if (offsets.length) onChange({ mode: 'ATM_OFFSETS', offsets: [...new Set(offsets)].sort((a, b) => a - b) });
              }}
            />
          </Tooltip>
        </>
      )}
      {(value.mode === 'ITM' || value.mode === 'OTM') && (
        <Tooltip content={H.editor.count}>
          <input
            type="number"
            min={1}
            max={50}
            aria-label="Number of strikes"
            className="input py-1 text-xs w-16"
            value={value.count}
            onChange={(e) => onChange({ mode: value.mode, count: Math.max(1, Math.round(Number(e.target.value))) })}
          />
        </Tooltip>
      )}
      {value.mode === 'SPECIFIC' && (
        <Tooltip content={{ title: 'Strikes', body: 'Comma-separated strike prices, e.g. 74500, 75000.' }}>
          <input
            aria-label="Specific strikes"
            className="input py-1 text-xs w-48 font-mono"
            defaultValue={value.strikes.join(', ')}
            key={value.strikes.join(',')}
            onBlur={(e) =>
              onChange({
                mode: 'SPECIFIC',
                strikes: e.target.value
                  .split(/[,\s]+/)
                  .filter(Boolean)
                  .map(Number)
                  .filter((n) => n > 0),
              })
            }
          />
        </Tooltip>
      )}
      {value.mode === 'RANGE' && (
        <>
          <input type="number" aria-label="Strike from" className="input py-1 text-xs w-24" value={value.from} onChange={(e) => onChange({ ...value, from: Number(e.target.value) })} />
          <span className="text-xs text-slate-500">to</span>
          <input type="number" aria-label="Strike to" className="input py-1 text-xs w-24" value={value.to} onChange={(e) => onChange({ ...value, to: Number(e.target.value) })} />
        </>
      )}
    </>
  );
}

export function UniverseEditor({ value, onChange, products }: { value: Universe; onChange: (u: Universe) => void; products: ProductRow[] }) {
  const product = products.find((p) => p.symbol === value.underlying);
  const optionExpiries = product?.optionExpiries.map((e) => e.expiry) ?? [];
  const futureExpiries = (product?.futures.map((f) => f.expiry).filter(Boolean) as string[]) ?? [];
  const t = value.target;
  const setTarget = (target: Universe['target']) => onChange({ ...value, target });
  const toggleType = (type: OptionType, on: boolean) => {
    if (t.kind !== 'OPTION') return;
    const set = new Set(t.optionTypes);
    if (on) set.add(type);
    else set.delete(type);
    setTarget({ ...t, optionTypes: (['CE', 'PE'] as const).filter((x) => set.has(x)) });
  };
  const groups = [...new Set(products.map((p) => p.group))];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <Cell label="Product" help={H.editor.product}>
          <select aria-label="Product" className="input py-1 text-xs" value={value.underlying} onChange={(e) => onChange({ ...value, underlying: e.target.value })}>
            {groups.map((g) => (
              <optgroup key={g} label={MCX2_GROUP_LABEL[g]}>
                {products
                  .filter((p) => p.group === g)
                  .map((p) => (
                    <option key={p.symbol} value={p.symbol}>
                      {p.symbol} — {p.name}
                      {!p.futures.length ? ' (not synced)' : !p.optionExpiries.length ? ' (futures only)' : ''}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </Cell>
        <Cell label="Instrument" help={H.editor.targetKind}>
          <Segmented
            label="Instrument type"
            value={t.kind}
            onChange={(k) =>
              setTarget(k === 'FUTURE' ? { kind: 'FUTURE', expiry: { mode: 'CURRENT' } } : { kind: 'OPTION', expiry: { mode: 'CURRENT' }, optionTypes: ['CE'], strikes: { mode: 'ATM_OFFSETS', offsets: [0] } })
            }
            options={[
              { value: 'FUTURE', label: <span className="text-leg-fut font-semibold">FUT</span>, help: { title: 'Futures', body: 'Signals per futures contract.' } },
              { value: 'OPTION', label: 'Options', help: { title: 'Options', body: 'Signals per selected option contract.' } },
            ]}
          />
        </Cell>
        <Cell label="Expiry" help={H.editor.expiry}>
          <ExpiryPicker label="Target expiry" value={t.expiry} onChange={(expiry) => setTarget({ ...t, expiry } as Universe['target'])} expiries={t.kind === 'OPTION' ? optionExpiries : futureExpiries} />
        </Cell>
        {t.kind === 'OPTION' && (
          <>
            <Cell label="Type" help={H.editor.optionTypes}>
              <Toggle checked={t.optionTypes.includes('CE')} onChange={(v) => toggleType('CE', v)} label="CE" help={{ title: 'Calls (CE)', body: 'Include call options.' }} />
              <Toggle checked={t.optionTypes.includes('PE')} onChange={(v) => toggleType('PE', v)} label="PE" help={{ title: 'Puts (PE)', body: 'Include put options.' }} />
            </Cell>
            <Cell label="Strikes" help={H.editor.strikes}>
              <StrikePicker value={t.strikes} onChange={(strikes) => setTarget({ ...t, strikes })} />
            </Cell>
          </>
        )}
        <Cell label="Reference future" help={H.editor.reference}>
          <select
            aria-label="Reference future"
            className="input py-1 text-xs"
            value={value.reference.expiry.mode}
            onChange={(e) => {
              const mode = e.target.value as ReferenceSelector['mode'];
              onChange({ ...value, reference: { expiry: mode === 'SPECIFIC' ? { mode, date: futureExpiries[0] ?? '' } : ({ mode } as ReferenceSelector) } });
            }}
          >
            <option value="MATCH_TARGET">Matching the target (recommended)</option>
            <option value="CURRENT">Current future</option>
            <option value="NEXT">Next future</option>
            <option value="FAR">Far future</option>
            <option value="SPECIFIC">Specific future</option>
          </select>
          {value.reference.expiry.mode === 'SPECIFIC' && (
            <ExpiryPicker label="Reference expiry" value={value.reference.expiry} onChange={(expiry) => onChange({ ...value, reference: { expiry } })} expiries={futureExpiries} />
          )}
        </Cell>
      </div>
    </div>
  );
}

/** The contracts the universe resolves to right now (ATM from the reference future's live price). */
export function ResolvedInstruments({ universe }: { universe: Universe }) {
  const q = useQuery({ queryKey: ['mcx2-universe', universe], queryFn: () => mcxApi.previewUniverse(universe), staleTime: 30_000, retry: false });
  const r = q.data;
  return (
    <div className="rounded-lg border border-ink-700/60 bg-ink-850 p-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-semibold text-slate-300">Resolved instruments</span>
        <InfoTip content={H.editor.resolved} />
        {r && (
          <span className={r.units.length > r.cap ? 'text-xs text-warn' : 'text-xs text-slate-500'}>
            {r.units.length} contract{r.units.length === 1 ? '' : 's'}
            {r.units.length > r.cap ? ` — above the cap of ${r.cap}` : ''}
          </span>
        )}
        <IconButton help={{ title: 'Refresh', body: 'Re-resolve with the latest live price.' }} onClick={() => q.refetch()} className="ml-auto p-1 rounded-md text-slate-500 hover:text-slate-200">
          <RefreshCw className={q.isFetching ? 'w-3.5 h-3.5 animate-spin' : 'w-3.5 h-3.5'} />
        </IconButton>
      </div>
      {q.isLoading && <Spinner label="Resolving…" />}
      {q.error && <p className="text-xs text-bear">{(q.error as Error).message}</p>}
      {r && (
        <>
          {r.references.length > 0 && (
            <p className="text-[11px] text-slate-500 mb-2">
              Reference: {r.references.map((x) => `${x.instrument.symbol}${x.ltp !== undefined ? ` @ ${fmtNum(x.ltp)}` : ' (no live price)'}`).join(' · ')}
              {r.units[0]?.atmStrike !== undefined && <> · ATM {r.units[0].atmStrike}</>}
            </p>
          )}
          {r.errors.map((e) => (
            <p key={e} className="text-xs text-warn">
              {e}
            </p>
          ))}
          {r.notes.map((e) => (
            <p key={e} className="text-[11px] text-slate-500">
              {e}
            </p>
          ))}
          {r.units.length > 0 && (
            <div className="overflow-x-auto mt-1">
              <table className="w-full text-xs">
                <thead className="text-left text-[10px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="py-1 pr-3">Contract</th>
                    <th className="py-1 pr-3 text-right">LTP</th>
                    <th className="py-1 pr-3 text-right">Volume</th>
                    <th className="py-1 text-right">OI</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-700/40">
                  {r.units.map((u) => {
                    const quote = r.quotes[u.target.id];
                    return (
                      <tr key={u.target.id}>
                        <td className="py-1 pr-3">
                          <InstrumentTag i={u.target} />
                          {u.atmStrike !== undefined && u.target.strike === u.atmStrike && <span className="ml-2 text-[10px] font-semibold text-accent-soft">ATM</span>}
                        </td>
                        <td className="py-1 pr-3 text-right tabular-nums">{fmtNum(quote?.ltp)}</td>
                        <td className="py-1 pr-3 text-right tabular-nums text-slate-400">{fmtNum(quote?.volume, 0)}</td>
                        <td className="py-1 text-right tabular-nums text-slate-400">{fmtNum(quote?.oi, 0)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
