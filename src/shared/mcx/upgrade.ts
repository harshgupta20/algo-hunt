/**
 * Upgrades stored strategy definitions to the current schema (v2: FUT / CE / PE legs).
 *
 * v1 had a target list (futures, or options with CE/PE ticks and ITM/OTM strikes),
 * a reference future, and operands addressed by role (TARGET / UNDERLYING / FIXED).
 * v2 scans futures, or strikes with three legs; operands name a leg.
 */
import type { ExprNode, Leg, McxStrategyDefinition, SeriesSpec, StrikeSelector } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */

function strikesV1(s: any, type: 'CE' | 'PE'): StrikeSelector {
  if (!s || typeof s !== 'object') return { mode: 'ATM_OFFSETS', offsets: [0] };
  if (s.mode === 'ITM' || s.mode === 'OTM') {
    // CE: ITM below ATM, OTM above. PE: the opposite.
    const up = (s.mode === 'OTM') === (type === 'CE');
    return { mode: 'ATM_OFFSETS', offsets: Array.from({ length: Math.max(1, Number(s.count) || 1) }, (_, i) => (up ? i + 1 : -(i + 1))) };
  }
  return s as StrikeSelector;
}

export function upgradeDefinition(raw: any): McxStrategyDefinition {
  if (!raw || raw.schemaVersion === 2) return raw as McxStrategyDefinition;
  const t = raw.universe?.target ?? {};
  const isOption = t.kind === 'OPTION';
  const type: 'CE' | 'PE' = isOption && Array.isArray(t.optionTypes) && t.optionTypes.length === 1 && t.optionTypes[0] === 'PE' ? 'PE' : 'CE';
  const targetLeg: Leg = isOption ? type : 'FUT';

  const series = (s: any): SeriesSpec => ({
    leg: s?.leg ?? (s?.instrument?.role === 'TARGET' ? targetLeg : 'FUT'),
    timeframe: s?.timeframe ?? '15m',
    candle: s?.candle ?? { type: 'NORMAL' },
  });
  const operand = (o: any) => (o && o.kind !== 'CONSTANT' && o.series ? { ...o, series: series(o.series) } : o);
  const node = (n: any): ExprNode => {
    switch (n?.type) {
      case 'AND':
      case 'OR':
        return { ...n, children: (n.children ?? []).map(node) };
      case 'NOT':
        return { ...n, child: node(n.child) };
      case 'PATTERN':
        return { ...n, series: series(n.series) };
      default:
        return { ...n, left: operand(n.left), right: operand(n.right) };
    }
  };

  return {
    ...raw,
    schemaVersion: 2,
    universe: {
      underlying: raw.universe?.underlying,
      target: isOption ? { kind: 'OPTION', expiry: t.expiry, strikes: strikesV1(t.strikes, type) } : { kind: 'FUTURE', expiry: t.expiry ?? { mode: 'CURRENT' } },
    },
    expression: node(raw.expression),
  } as McxStrategyDefinition;
}
