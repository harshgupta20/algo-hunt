/**
 * Paper-trading results: per strategy, per connection and overall, plus what a trader decides with —
 * the equity curve, P&L per day, how trades closed and P&L by the hour they were entered.
 */
import type { PaperExitReason, PaperPlan, PaperOverride, PaperStats, PaperSummary, PaperTrade, V2Connection, V2Strategy } from '@/shared/v2';
import { defaultPaperPlan, effectivePlan } from '@/shared/v2';
import { IST_OFFSET_MS, istDate } from '../../utils/marketTime';
import { unrealizedPnl } from './PaperTrader';

const round2 = (n: number) => Math.round(n * 100) / 100;
const SPARK_POINTS = 30;

/** Most money in use at once: open trades' capital summed over time (a close frees money before a same-instant open). */
function capitalPeak(trades: PaperTrade[], now: number): number {
  const events: Array<[at: number, delta: number]> = [];
  for (const t of trades) {
    events.push([Date.parse(t.entryAt), t.capitalUsed]);
    events.push([t.exitAt ? Date.parse(t.exitAt) : now, -t.capitalUsed]);
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0;
  let peak = 0;
  for (const [, d] of events) {
    cur += d;
    peak = Math.max(peak, cur);
  }
  return round2(peak);
}

const byExit = (a: PaperTrade, b: PaperTrade) => (a.exitAt ?? '').localeCompare(b.exitAt ?? '');
const closedOf = (trades: PaperTrade[]) => trades.filter((t) => t.status === 'CLOSED').sort(byExit);

/** Cumulative net P&L after each closed trade, thinned to at most `max` points (for sparklines). */
function spark(trades: PaperTrade[], max = SPARK_POINTS): number[] {
  let cum = 0;
  const all = closedOf(trades).map((t) => round2((cum += t.netPnl ?? 0)));
  if (all.length <= max) return all;
  return Array.from({ length: max }, (_, i) => all[Math.round((i / (max - 1)) * (all.length - 1))]!);
}

export function paperStats(trades: PaperTrade[], now: number): PaperStats {
  const closed = closedOf(trades);
  const open = trades.filter((t) => t.status === 'OPEN');
  const nets = closed.map((t) => t.netPnl ?? 0);
  const netPnl = round2(nets.reduce((a, b) => a + b, 0));
  const wins = nets.filter((n) => n > 0);
  const losses = nets.filter((n) => n < 0);
  const won = wins.reduce((a, b) => a + b, 0);
  const lost = -losses.reduce((a, b) => a + b, 0);
  let cum = 0;
  let high = 0;
  let maxDrawdown = 0;
  for (const n of nets) {
    cum += n;
    high = Math.max(high, cum);
    maxDrawdown = Math.min(maxDrawdown, cum - high);
  }
  const peak = capitalPeak(trades, now);
  const today = istDate(now);
  return {
    trades: closed.length,
    open: open.length,
    wins: wins.length,
    losses: losses.length,
    winRate: closed.length ? round2((wins.length / closed.length) * 100) : null,
    grossPnl: round2(closed.reduce((a, t) => a + (t.grossPnl ?? 0), 0)),
    charges: round2(closed.reduce((a, t) => a + (t.charges ?? 0), 0)),
    netPnl,
    unrealizedPnl: round2(open.reduce((a, t) => a + unrealizedPnl(t), 0)),
    avgPnl: closed.length ? round2(netPnl / closed.length) : null,
    best: nets.length ? Math.max(...nets) : null,
    worst: nets.length ? Math.min(...nets) : null,
    capitalPeak: peak,
    returnPct: peak > 0 && closed.length ? round2((netPnl / peak) * 100) : null,
    maxDrawdown: round2(maxDrawdown),
    overBudget: trades.filter((t) => t.overBudget).length,
    profitFactor: lost > 0 ? round2(won / lost) : null,
    avgWin: wins.length ? round2(won / wins.length) : null,
    avgLoss: losses.length ? round2(-lost / losses.length) : null,
    todayPnl: round2(closed.filter((t) => t.exitAt && istDate(Date.parse(t.exitAt)) === today).reduce((a, t) => a + (t.netPnl ?? 0), 0)),
    lastExitAt: closed.at(-1)?.exitAt ?? null,
  };
}

export interface SummaryInput {
  trades: PaperTrade[];
  strategies: V2Strategy[];
  connections: V2Connection[];
  plans: Array<{ strategyId: string; plan: PaperPlan }>;
  overrides: Array<{ connectionId: string; override: PaperOverride }>;
  now: number;
  from?: string | null;
  strategyId?: string;
}

export function paperSummary(x: SummaryInput): PaperSummary {
  const { trades, now } = x;
  const group = <K>(key: (t: PaperTrade) => K) => {
    const m = new Map<K, PaperTrade[]>();
    for (const t of trades) m.set(key(t), [...(m.get(key(t)) ?? []), t]);
    return m;
  };
  const byStrategy = group((t) => t.strategyId);
  const byConnection = group((t) => t.connectionId);
  const strategies = x.strategies.filter((s) => !x.strategyId || s.id === x.strategyId);
  const stored = new Map(x.plans.map((p) => [p.strategyId, p.plan]));
  const planOf = (s: V2Strategy) => stored.get(s.id) ?? defaultPaperPlan(s.definition);
  const overrides = new Map(x.overrides.map((o) => [o.connectionId, o.override]));
  const byId = new Map(strategies.map((s) => [s.id, s]));
  const conns = x.connections.filter((c) => byId.has(c.strategyId) && (c.enabled || byConnection.has(c.id)));

  const closed = closedOf(trades);
  let cum = 0;
  const daily = new Map<string, { date: string; pnl: number; trades: number; wins: number }>();
  const reasons = new Map<PaperExitReason, { reason: PaperExitReason; trades: number; pnl: number }>();
  const hours = new Map<number, { hour: number; trades: number; pnl: number; wins: number }>();
  for (const t of closed) {
    const net = t.netPnl ?? 0;
    const d = istDate(Date.parse(t.exitAt!));
    const day = daily.get(d) ?? { date: d, pnl: 0, trades: 0, wins: 0 };
    day.pnl = round2(day.pnl + net);
    day.trades++;
    if (net > 0) day.wins++;
    daily.set(d, day);
    const r = t.exitReason ?? 'MANUAL';
    const rr = reasons.get(r) ?? { reason: r, trades: 0, pnl: 0 };
    rr.trades++;
    rr.pnl = round2(rr.pnl + net);
    reasons.set(r, rr);
    const h = new Date(Date.parse(t.entryAt) + IST_OFFSET_MS).getUTCHours();
    const hh = hours.get(h) ?? { hour: h, trades: 0, pnl: 0, wins: 0 };
    hh.trades++;
    hh.pnl = round2(hh.pnl + net);
    if (net > 0) hh.wins++;
    hours.set(h, hh);
  }

  return {
    from: x.from ?? null,
    overall: paperStats(trades, now),
    strategies: strategies
      .filter((s) => byStrategy.has(s.id) || conns.some((c) => c.strategyId === s.id))
      .map((s) => {
        const plan = planOf(s);
        const list = byStrategy.get(s.id) ?? [];
        return { strategyId: s.id, name: s.name, enabled: plan.enabled, cashPerTrade: plan.cashPerTrade, connections: conns.filter((c) => c.strategyId === s.id).length, stats: paperStats(list, now), spark: spark(list) };
      }),
    connections: conns.map((c) => {
      const s = byId.get(c.strategyId)!;
      const o = overrides.get(c.id);
      const eff = effectivePlan(planOf(s), o);
      const list = byConnection.get(c.id) ?? [];
      return {
        connectionId: c.id,
        strategyId: c.strategyId,
        strategyName: s.name,
        productId: c.productId,
        symbol: c.productId.split(':')[1] ?? c.productId,
        switchedOn: c.enabled,
        paper: { enabled: eff.enabled, cashPerTrade: eff.cashPerTrade, targetPct: eff.targetPct, stopPct: eff.stopPct, squareOff: eff.squareOff, custom: !!o && Object.keys(o).length > 0 },
        stats: paperStats(list, now),
        spark: spark(list),
      };
    }),
    equity: closed.map((t) => ({ at: t.exitAt!, pnl: round2((cum += t.netPnl ?? 0)) })),
    daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
    reasons: [...reasons.values()].sort((a, b) => b.trades - a.trades),
    hours: [...hours.values()].sort((a, b) => a.hour - b.hour),
  };
}
