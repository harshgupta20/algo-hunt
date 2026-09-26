/**
 * Debugging without side effects:
 *   explain — evaluate a strategy's units right now (same data + engine as the
 *             scanner) and show, per unit, every condition's values and what
 *             the alert policy would do. Nothing is persisted or delivered.
 *   replay  — step a strategy through past trigger candles for its current
 *             targets (or chosen contracts) and list where it would have signalled.
 */
import type {
  ConditionTrace,
  ExprTrace,
  McxInstrument,
  McxStrategyDefinition,
  McxTimeframe,
  McxUnit,
  SignalOutcome,
  TriState,
  UnitEvaluation,
  UnitState,
  UniverseResolution,
} from '@/shared/mcx';
import { MCX2_TIMEFRAME } from '@/shared/mcx';
import { istDate } from '../../utils/marketTime';
import { decide, initialState } from '../alerts/alertPolicy';
import { McxMarketCalendar, dateStartMs } from '../calendar/McxMarketCalendar';
import { CandleService } from '../data/CandleService';
import type { McxDataProvider } from '../data/McxDataProvider';
import type { McxInstrumentService } from '../data/McxInstrumentService';
import { evaluateUnit, type UnitEvalInput } from '../engine/evaluator';
import { legInstrument, seriesOf } from '../engine/series';
import type { McxStore } from '../persistence/McxStore';
import { referenceFutures, resolveUniverse, unitForKey } from '../universe/UniverseResolver';

export interface DryRunDeps {
  store: McxStore;
  provider: McxDataProvider;
  instruments: McxInstrumentService;
  clock?: () => number;
}

export interface DryStrategy {
  id?: string;
  version?: number;
  enabledAt?: string | null;
  definition: McxStrategyDefinition;
}

export interface ExplainUnit {
  unit: McxUnit;
  evaluation?: UnitEvaluation;
  prevResult: TriState | null;
  /** What the alert policy would do with this evaluation given the unit's stored state. */
  outcome?: SignalOutcome;
  state: UnitState | null;
  error?: string;
}

export interface ExplainResult {
  evaluatedAt: number;
  triggerCandle: number;
  at: number;
  resolution: Pick<UniverseResolution, 'errors' | 'notes' | 'expiries'> & { references: Array<{ symbol: string; ltp?: number }> };
  units: ExplainUnit[];
  requests: number;
  errors: string[];
}

export interface ReplayRequest {
  from: string;
  to: string;
  /** Units to replay (keys); default = the strategy's current units (current ATM). */
  unitKeys?: string[];
}

export interface ReplayRow {
  candleTime: number;
  at: number;
  result: TriState;
  outcome?: SignalOutcome;
  prices: UnitEvaluation['prices'];
  /** Conditions that were FALSE / UNKNOWN on this candle. */
  failing: string[];
  /** Full trace, kept for signal candles. */
  trace?: ExprTrace;
}

export interface ReplayUnit {
  unit: McxUnit;
  rows: ReplayRow[];
  signals: number;
}

export interface ReplayResult {
  from: string;
  to: string;
  triggerTimeframe: McxTimeframe;
  candles: number;
  units: ReplayUnit[];
  notes: string[];
  errors: string[];
  requests: number;
}

export const REPLAY_MAX_UNITS = 10;
/** Longest replay span (calendar days) per trigger timeframe. */
export const REPLAY_MAX_DAYS: Record<McxTimeframe, number> = {
  '1m': 2,
  '3m': 5,
  '5m': 5,
  '10m': 10,
  '15m': 15,
  '30m': 20,
  '1h': 45,
  '2h': 60,
  '4h': 90,
  '1d': 365,
  '1w': 730,
};

const DAY = 86_400_000;
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const msg = (err: unknown) => (err instanceof Error ? err.message : String(err));

function leaves(t: ExprTrace, out: ConditionTrace[] = []): ConditionTrace[] {
  if (t.condition) out.push(t.condition);
  t.children?.forEach((c) => leaves(c, out));
  return out;
}

/** Open times (ms) of every trigger candle in [from, to] that closed by `until`. */
export function triggerOpens(cal: McxMarketCalendar, from: string, to: string, tf: McxTimeframe, until: number): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (!cal.isTradingDay(d)) continue;
    if (tf === '1d') out.push(dateStartMs(d));
    else if (tf === '1w') {
      const wk = cal.periodOpen(dateStartMs(d), '1w');
      if (!seen.has(wk)) {
        seen.add(wk);
        out.push(wk);
      }
    } else {
      const end = cal.sessionEnd(d);
      for (let open = cal.sessionStart(d); open < end; open = cal.candleClose(open, tf)) out.push(open);
    }
  }
  return out.filter((o) => cal.candleClose(o, tf) <= until);
}

async function fetchFor(candles: CandleService, d: McxStrategyDefinition, units: McxUnit[], errors: string[]): Promise<void> {
  const jobs = new Map<string, { inst: McxInstrument; tf: McxTimeframe }>();
  const specs = seriesOf(d);
  for (const u of units) {
    for (const s of specs) {
      const inst = legInstrument(s.leg, u);
      if (inst) jobs.set(CandleService.nativeKey(inst, MCX2_TIMEFRAME[s.timeframe].native), { inst, tf: s.timeframe });
    }
  }
  await Promise.all(
    [...jobs.values()].map((j) =>
      candles.fetchSeries(j.inst, j.tf).catch((err) => {
        errors.push(`${j.inst.symbol} ${MCX2_TIMEFRAME[j.tf].native}: ${msg(err)}`);
      }),
    ),
  );
}

export class McxDryRun {
  constructor(private readonly deps: DryRunDeps) {}

  private now(): number {
    return this.deps.clock ? this.deps.clock() : Date.now();
  }

  private async context() {
    const all = await this.deps.instruments.list();
    const calendar = new McxMarketCalendar(await this.deps.store.calendar.list());
    return { all, calendar };
  }

  async explain(s: DryStrategy, opts: { unitKey?: string } = {}): Promise<ExplainResult> {
    const now = this.now();
    const d = s.definition;
    const { all, calendar } = await this.context();
    const settings = await this.deps.store.settings.get();
    const errors: string[] = [];
    const today = istDate(now);
    let requests = 0;

    const tf = d.evaluation.triggerTimeframe;
    const live = d.evaluation.mode === 'LIVE_CANDLE';
    const open = live ? calendar.periodOpen(now, tf) : calendar.lastCompletedOpen(now, tf);
    if (open === null) throw new Error('No completed trigger candle in the last two weeks of the calendar');
    const at = live ? now : calendar.candleClose(open, tf);
    const prevOpen = calendar.lastCompletedOpen(open, tf);
    const prevAt = prevOpen === null ? null : live ? open : calendar.candleClose(prevOpen, tf);

    const refs = referenceFutures(d.universe, all, today);
    let ltp = new Map<number, number>();
    if (refs.length) {
      try {
        ltp = await this.deps.provider.getLtp(refs);
        requests++;
      } catch (err) {
        errors.push(`LTP for ATM failed: ${msg(err)}`);
      }
    }
    const res = resolveUniverse(d.universe, all, ltp, today);
    let units = res.units;
    if (opts.unitKey) {
      const unit = units.find((u) => u.key === opts.unitKey) ?? unitForKey(all, opts.unitKey, today);
      if (!unit) throw new Error(`Unit ${opts.unitKey} is not in the MCX V2 instrument list`);
      units = [unit];
    } else if (units.length > settings.universeCap) {
      errors.push(`${units.length} units exceed the cap of ${settings.universeCap}; showing the first ${settings.universeCap}`);
      units = units.slice(0, settings.universeCap);
    }

    const candles = new CandleService(this.deps.provider, calendar, now);
    await fetchFor(candles, d, units, errors);
    requests += candles.requests;
    const memo = new Map<string, unknown>();
    const states = s.id ? new Map((await this.deps.store.units.list(s.id)).map((x) => [x.unitKey, x])) : new Map<string, UnitState>();

    const out: ExplainUnit[] = units.map((unit) => {
      const state = states.get(unit.key) ?? null;
      try {
        const input: UnitEvalInput = {
          strategyId: s.id ?? 'draft',
          version: s.version ?? 0,
          definition: d,
          unit,
          lookup: candles.lookup,
          triggerOpenMs: open,
          at,
          memo,
        };
        const evaluation = evaluateUnit(input);
        const prevResult =
          prevOpen === null || prevAt === null ? null : evaluateUnit({ ...input, mode: 'COMPLETED_CANDLE', triggerOpenMs: prevOpen, at: prevAt }).result;
        const decision = decide({
          policy: d.alert,
          state: state ?? initialState(s.id ?? 'draft', unit.key),
          result: evaluation.result,
          prevResult,
          triggerCandle: evaluation.triggerCandle,
          at,
          now,
          enabledAt: s.enabledAt ?? null,
          mode: d.evaluation.mode,
        });
        return { unit, evaluation, prevResult, outcome: decision.outcome, state };
      } catch (err) {
        return { unit, prevResult: null, state, error: msg(err) };
      }
    });

    return {
      evaluatedAt: now,
      triggerCandle: Math.floor(open / 1000),
      at,
      resolution: {
        errors: res.errors,
        notes: res.notes,
        expiries: res.expiries,
        references: res.references.map((r) => ({ symbol: r.instrument.symbol, ltp: r.ltp })),
      },
      units: out,
      requests,
      errors,
    };
  }

  async replay(s: DryStrategy, req: ReplayRequest): Promise<ReplayResult> {
    const now = this.now();
    const d = s.definition;
    const tf = d.evaluation.triggerTimeframe;
    if (req.from > req.to) throw new Error('"from" must be on or before "to"');
    const span = (Date.parse(req.to) - Date.parse(req.from)) / DAY + 1;
    if (span > REPLAY_MAX_DAYS[tf]) throw new Error(`Replay of ${MCX2_TIMEFRAME[tf].label} candles is limited to ${REPLAY_MAX_DAYS[tf]} days`);
    const { all, calendar } = await this.context();
    const today = istDate(now);
    const errors: string[] = [];
    const notes: string[] = [];
    let requests = 0;

    let units: McxUnit[];
    if (req.unitKeys?.length) {
      units = req.unitKeys.map((key) => {
        const u = unitForKey(all, key, today);
        if (!u) throw new Error(`Unit ${key} is not in the MCX V2 instrument list`);
        return u;
      });
    } else {
      const refs = referenceFutures(d.universe, all, today);
      let ltp = new Map<number, number>();
      if (refs.length) {
        ltp = await this.deps.provider.getLtp(refs);
        requests++;
      }
      const res = resolveUniverse(d.universe, all, ltp, today);
      errors.push(...res.errors);
      units = res.units;
      if (d.universe.target.kind === 'OPTION' && d.universe.target.strikes.mode === 'ATM_OFFSETS') notes.push('Strikes are today’s ATM selection; past ATM shifts are not replayed.');
    }
    if (units.length > REPLAY_MAX_UNITS) {
      notes.push(`Replaying the first ${REPLAY_MAX_UNITS} of ${units.length} units`);
      units = units.slice(0, REPLAY_MAX_UNITS);
    }
    if (d.evaluation.mode === 'LIVE_CANDLE') notes.push('Live-candle strategies are replayed on completed candles (intra-candle history is not available)');

    // The replay clock stops at the end of `to` (or now): later candles never leak in.
    const until = Math.min(now, dateStartMs(addDays(req.to, 1)));
    const candles = new CandleService(this.deps.provider, calendar, until, Infinity, { from: req.from, to: req.to });
    await fetchFor(candles, d, units, errors);
    requests += candles.requests;

    const opens = triggerOpens(calendar, req.from, req.to, tf, candles.now);
    const memo = new Map<string, unknown>();
    const out: ReplayUnit[] = units.map((unit) => {
      const rows: ReplayRow[] = [];
      let state = initialState(s.id ?? 'replay', unit.key);
      const base: Omit<UnitEvalInput, 'triggerOpenMs' | 'at'> = {
        strategyId: s.id ?? 'replay',
        version: s.version ?? 0,
        definition: d,
        unit,
        lookup: candles.lookup,
        mode: 'COMPLETED_CANDLE',
        memo,
      };
      let prev: TriState | null = null;
      if (opens.length) {
        const p = calendar.lastCompletedOpen(opens[0]!, tf);
        if (p !== null) prev = evaluateUnit({ ...base, triggerOpenMs: p, at: calendar.candleClose(p, tf) }).result;
      }
      let signals = 0;
      for (const open of opens) {
        const at = calendar.candleClose(open, tf);
        const e = evaluateUnit({ ...base, triggerOpenMs: open, at });
        const decision = decide({
          policy: d.alert,
          state,
          result: e.result,
          prevResult: prev,
          triggerCandle: e.triggerCandle,
          at,
          now: at,
          enabledAt: null,
          mode: 'COMPLETED_CANDLE',
        });
        state = { ...decision.next, lastEvaluatedCandle: e.triggerCandle };
        if (decision.outcome) signals++;
        rows.push({
          candleTime: e.triggerCandle,
          at,
          result: e.result,
          outcome: decision.outcome,
          prices: e.prices,
          failing: leaves(e.trace)
            .filter((c) => c.result !== 'TRUE')
            .map((c) => (c.result === 'UNKNOWN' && c.reason ? `${c.text} — ${c.reason}` : c.text)),
          trace: decision.outcome ? e.trace : undefined,
        });
        prev = e.result;
      }
      return { unit, rows, signals };
    });

    return { from: req.from, to: req.to, triggerTimeframe: tf, candles: opens.length, units: out, notes, errors, requests };
  }
}
