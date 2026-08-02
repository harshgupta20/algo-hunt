import type { BacktestAlert, Leg } from '@ash/shared';

/** Short trigger label for a backtest alert (built-in scenario or custom variant). */
export function btRuleLabel(a: BacktestAlert): string {
  return a.scenario ? `Scenario ${a.scenario}` : (a.variant ?? 'Triggered');
}

/** A per-leg display value: built-in RSI reading, else the matching condition's value. */
export function btLegValue(a: BacktestAlert, leg: Leg): number | undefined {
  if (a.readings) return a.readings[leg]?.curr;
  return a.conditions?.find((c) => c.instrument === leg)?.curr;
}
