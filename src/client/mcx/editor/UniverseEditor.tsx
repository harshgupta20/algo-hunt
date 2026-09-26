'use client';

/**
 * WHAT + WHERE: product, Futures or Options, expiry and strikes — plus the live
 * list of what that selects. With Options, every strike is one unit with three
 * legs for conditions: FUT (the future these options expire into), CE and PE.
 */
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import type { ExpirySelector, StrikeSelector, Universe } from '@/shared/mcx';
import { MCX2_ATM_PRESETS, MCX2_EXPIRY_MODES, MCX2_GROUP_LABEL, MCX2_STRIKE_MODES } from '@/shared/mcx';
import { InfoTip, Tooltip } from '../../components/Tooltip';
import { IconButton, Spinner } from '../../components/ui';
import { mcxApi, type ProductRow } from '../api';
import { Cell, InstrumentTag, LEG_TEXT, Segmented, UnitTag } from '../components';
import { fmtNum } from '../format';
import { H } from '../help';

function ExpiryPicker({ value, onChange, expiries }: { value: ExpirySelector; onChange: (e: ExpirySelector) => void; expiries: string[] }) {
  return (
    <>
      <select
        aria-label="Expiry"
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
        <select aria-label="Expiry date" className="input py-1 text-xs" value={value.date} onChange={(e) => onChange({ mode: 'SPECIFIC', date: e.target.value })}>
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

const sameOffsets = (a: number[], b: number[]) => a.length === b.length && [...a].sort((x, y) => x - y).every((v, i) => v === [...b].sort((x, y) => x - y)[i]);

function StrikePicker({ value, onChange }: { value: StrikeSelector; onChange: (s: StrikeSelector) => void }) {
  const setMode = (mode: StrikeSelector['mode']) => {
    if (mode === 'ATM_OFFSETS') onChange({ mode, offsets: [0] });
    else if (mode === 'SPECIFIC') onChange({ mode, strikes: [] });
    else if (mode === 'RANGE') onChange({ mode, from: 0, to: 0 });
    else onChange({ mode: 'ALL' });
  };
  const preset = value.mode === 'ATM_OFFSETS' ? MCX2_ATM_PRESETS.find((p) => sameOffsets(p.offsets, value.offsets)) : undefined;
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
          <Tooltip content={H.editor.atmPreset}>
            <select
              aria-label="Strikes around ATM"
              className="input py-1 text-xs"
              value={preset?.key ?? 'custom'}
              onChange={(e) => {
                const p = MCX2_ATM_PRESETS.find((x) => x.key === e.target.value);
                if (p) onChange({ mode: 'ATM_OFFSETS', offsets: p.offsets });
              }}
            >
              {MCX2_ATM_PRESETS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
              {!preset && <option value="custom">Custom</option>}
            </select>
          </Tooltip>
          <Tooltip content={H.editor.offsets}>
            <input
              aria-label="ATM offsets"
              className="input py-1 text-xs w-32 font-mono"
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
  const groups = [...new Set(products.map((p) => p.group))];

  return (
    <div className="flex flex-col gap-3">
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
        <Cell label="Scan" help={H.editor.targetKind}>
          <Segmented
            label="Scan futures or options"
            value={t.kind}
            onChange={(k) =>
              onChange({ ...value, target: k === 'FUTURE' ? { kind: 'FUTURE', expiry: { mode: 'CURRENT' } } : { kind: 'OPTION', expiry: { mode: 'CURRENT' }, strikes: { mode: 'ATM_OFFSETS', offsets: [0] } } })
            }
            options={[
              { value: 'FUTURE', label: 'Futures', help: { title: 'Futures', body: 'One alert per futures contract. Conditions use the FUT leg.' } },
              { value: 'OPTION', label: 'Options', help: { title: 'Options', body: 'One alert per strike. Conditions can use FUT, CE and PE of that strike.' } },
            ]}
          />
        </Cell>
        <Cell label={t.kind === 'OPTION' ? 'Option expiry' : 'Expiry'} help={H.editor.expiry}>
          <ExpiryPicker value={t.expiry} onChange={(expiry) => onChange({ ...value, target: { ...t, expiry } as Universe['target'] })} expiries={t.kind === 'OPTION' ? optionExpiries : futureExpiries} />
        </Cell>
        {t.kind === 'OPTION' && (
          <Cell label="Strikes" help={H.editor.strikes}>
            <StrikePicker value={t.strikes} onChange={(strikes) => onChange({ ...value, target: { ...t, strikes } })} />
          </Cell>
        )}
      </div>
      <p className="text-[11px] text-slate-500">
        {t.kind === 'OPTION' ? (
          <>
            Each strike gives your conditions three legs: <span className={clsx('font-semibold', LEG_TEXT.FUT)}>FUT</span> (the future these options expire into),{' '}
            <span className={clsx('font-semibold', LEG_TEXT.CE)}>CE</span> and <span className={clsx('font-semibold', LEG_TEXT.PE)}>PE</span> at that strike.
          </>
        ) : (
          <>
            Conditions use the <span className={clsx('font-semibold', LEG_TEXT.FUT)}>FUT</span> leg. Switch to Options to add CE / PE conditions.
          </>
        )}
      </p>
    </div>
  );
}

/** What the universe selects right now (ATM from the future's live price), with live quotes per leg. */
export function ResolvedInstruments({ universe }: { universe: Universe }) {
  const q = useQuery({ queryKey: ['mcx2-universe', universe], queryFn: () => mcxApi.previewUniverse(universe), staleTime: 30_000, retry: false });
  const r = q.data;
  const isOption = universe.target.kind === 'OPTION';
  const quote = (id: string | undefined) => (id ? r?.quotes[id] : undefined);
  return (
    <div className="rounded-lg border border-ink-700/60 bg-ink-850 p-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-semibold text-slate-300">Selected {isOption ? 'strikes' : 'futures'}</span>
        <InfoTip content={H.editor.resolved} />
        {r && (
          <span className={r.units.length > r.cap ? 'text-xs text-warn' : 'text-xs text-slate-500'}>
            {r.units.length}
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
          {isOption && r.units[0]?.fut && (
            <p className="text-[11px] text-slate-500 mb-2">
              <span className={clsx('font-semibold', LEG_TEXT.FUT)}>FUT</span> {r.units[0].fut.symbol} {fmtNum(quote(r.units[0].fut.id)?.ltp ?? r.references[0]?.ltp)}
              {r.units[0].atmStrike !== undefined && <> · ATM {r.units[0].atmStrike}</>}
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
                  {isOption ? (
                    <tr>
                      <th className="py-1 pr-3">Strike</th>
                      <th className={clsx('py-1 pr-3 text-right', LEG_TEXT.CE)}>CE LTP</th>
                      <th className={clsx('py-1 pr-3 text-right', LEG_TEXT.CE)}>CE OI</th>
                      <th className={clsx('py-1 pr-3 text-right', LEG_TEXT.PE)}>PE LTP</th>
                      <th className={clsx('py-1 text-right', LEG_TEXT.PE)}>PE OI</th>
                    </tr>
                  ) : (
                    <tr>
                      <th className="py-1 pr-3">Contract</th>
                      <th className="py-1 pr-3 text-right">LTP</th>
                      <th className="py-1 pr-3 text-right">Volume</th>
                      <th className="py-1 text-right">OI</th>
                    </tr>
                  )}
                </thead>
                <tbody className="divide-y divide-ink-700/40">
                  {r.units.map((u) =>
                    isOption ? (
                      <tr key={u.key}>
                        <td className="py-1 pr-3">
                          <UnitTag unit={u} />
                        </td>
                        <td className="py-1 pr-3 text-right tabular-nums">{fmtNum(quote(u.ce?.id)?.ltp)}</td>
                        <td className="py-1 pr-3 text-right tabular-nums text-slate-400">{fmtNum(quote(u.ce?.id)?.oi, 0)}</td>
                        <td className="py-1 pr-3 text-right tabular-nums">{fmtNum(quote(u.pe?.id)?.ltp)}</td>
                        <td className="py-1 text-right tabular-nums text-slate-400">{fmtNum(quote(u.pe?.id)?.oi, 0)}</td>
                      </tr>
                    ) : (
                      <tr key={u.key}>
                        <td className="py-1 pr-3">{u.fut && <InstrumentTag i={u.fut} />}</td>
                        <td className="py-1 pr-3 text-right tabular-nums">{fmtNum(quote(u.fut?.id)?.ltp)}</td>
                        <td className="py-1 pr-3 text-right tabular-nums text-slate-400">{fmtNum(quote(u.fut?.id)?.volume, 0)}</td>
                        <td className="py-1 text-right tabular-nums text-slate-400">{fmtNum(quote(u.fut?.id)?.oi, 0)}</td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
