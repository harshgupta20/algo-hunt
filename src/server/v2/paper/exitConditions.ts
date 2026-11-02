/**
 * Stop / target conditions of open paper trades, live. Each condition is checked at every close of its own
 * timeframe (the smallest it uses) on Kite's candles — the data the backup scanner and the backtests read — once the
 * candle is published (a few seconds after the close, up to the evaluator's data grace). The legs are the contracts
 * of the unit the trade opened on, as the backtests check them. A condition that comes true closes the trade at the
 * market price (PaperTrader.monitor).
 *
 * Only the latest closed candle is looked at: a candle that closed while neither the live worker nor the scanner
 * was running isn't checked afterwards.
 */
import type { Market, PaperTrade, V2Unit } from '@/shared/v2';
import { marketOfExchange } from '@/shared/v2';
import type { MarketCalendar } from '../calendar/MarketCalendar';
import { CandleService } from '../data/CandleService';
import type { V2DataProvider } from '../data/DataProvider';
import { DATA_GRACE_MS, evaluateUnit, pendingReason, type UnitEvalInput } from '../engine/evaluator';
import { exitDefinition, legInstrument, seriesOf } from '../engine/series';

export type ConditionExit = { id: string; reason: 'STOP_RULE' | 'TARGET_RULE' };

export class ConditionWatch {
  /** The last candle close (ms) decided per trade and condition (`<id>|STOP_RULE`). */
  private readonly checked = new Map<string, number>();

  constructor(private readonly provider: V2DataProvider) {}

  /** The open trades whose stop (first) or target condition came true on the candle that closed last. */
  async check(trades: PaperTrade[], cals: Record<Market, MarketCalendar>, now: number): Promise<ConditionExit[]> {
    const live = new Set(trades.map((t) => t.id));
    for (const k of [...this.checked.keys()]) if (!live.has(k.slice(0, k.lastIndexOf('|')))) this.checked.delete(k);

    // What is due: a condition whose timeframe closed a candle after the trade opened, not decided yet.
    const due: Array<{ t: PaperTrade; reason: ConditionExit['reason']; input: UnitEvalInput; key: string }> = [];
    for (const t of trades) {
      const c = t.conditions;
      if (!c) continue;
      const cal = cals[marketOfExchange(t.instrument.exchange)];
      const unit: V2Unit = { key: t.unitKey, productId: t.productId, expiry: t.instrument.expiry, baseStrike: null, shift: 0, legs: c.legs };
      for (const [reason, when] of [
        ['STOP_RULE', c.stopWhen],
        ['TARGET_RULE', c.targetWhen],
      ] as const) {
        if (!when) continue;
        const definition = exitDefinition({ legs: c.legDefs, evaluation: { mode: 'COMPLETED_CANDLE', triggerTimeframe: '1m' } }, when);
        const tf = definition.evaluation.triggerTimeframe;
        const open = cal.lastCompletedOpen(now, tf);
        if (open === null) continue;
        const at = cal.candleClose(open, tf);
        const key = `${t.id}|${reason}`;
        if (at <= Date.parse(t.entryAt) || (this.checked.get(key) ?? -Infinity) >= at) continue;
        due.push({ t, reason, key, input: { strategyId: t.strategyId, version: 0, productId: t.productId, definition, unit, lookup: () => ({ error: '' }), triggerOpenMs: open, at, mode: 'COMPLETED_CANDLE' } });
      }
    }
    if (!due.length) return [];

    const candles = new CandleService(this.provider, cals, now);
    const fetches = new Map<string, Promise<unknown>>();
    for (const d of due) {
      for (const s of seriesOf(d.input.definition)) {
        const inst = legInstrument(s.leg, d.input.unit);
        if (inst) fetches.set(`${inst.token}|${s.timeframe}`, candles.fetchSeries(inst, s.timeframe).catch(() => undefined));
      }
    }
    await Promise.all(fetches.values());

    const out: ConditionExit[] = [];
    const fired = new Set<string>();
    for (const d of due) {
      if (fired.has(d.t.id)) continue; // the stop closed it already
      const input = { ...d.input, lookup: candles.lookup };
      if (pendingReason(input, now)) continue; // Kite hasn't published the candle yet — look again next time
      const r = evaluateUnit(input).result;
      // UNKNOWN within the data grace: try again; after it (or decided either way) the candle is done.
      if (r === 'UNKNOWN' && now - d.input.at < DATA_GRACE_MS) continue;
      this.checked.set(d.key, d.input.at);
      if (r === 'TRUE') {
        fired.add(d.t.id);
        out.push({ id: d.t.id, reason: d.reason });
      }
    }
    return out;
  }
}
