/**
 * The generic strategy evaluator — the SINGLE source of truth for custom
 * (builder-created) strategies, used identically by the live worker and the
 * backtest runner. It owns the indicator instances a strategy needs (one per
 * instrument + indicator signature), is fed closed bars, and fires on the
 * rising edge of the root rule tree, returning the matched branch + trace.
 */
import type { ConditionTrace, IndicatorRef, StrategyDef, StrategyNode } from '@ash/shared';
import { createIndicator, indicatorSignature } from '../indicator/registry.js';
import type { Bar, Indicator } from '../indicator/types.js';
import { evaluateCondition, evaluateGroup, type Resolve } from './conditionEngine.js';

export interface StrategyMatchResult {
  variant: string;
  traces: ConditionTrace[];
}

export class CustomStrategyEvaluator {
  private readonly indicators = new Map<string, Map<string, Indicator>>();
  private prevPassed = false;

  constructor(readonly def: StrategyDef) {
    this.collect(def.root);
  }

  private ensure(instrument: string, ref: IndicatorRef): void {
    let m = this.indicators.get(instrument);
    if (!m) {
      m = new Map();
      this.indicators.set(instrument, m);
    }
    const sig = indicatorSignature(ref);
    if (!m.has(sig)) m.set(sig, createIndicator(ref));
  }

  private collect(node: StrategyNode): void {
    if (node.type === 'condition') {
      this.ensure(node.instrument, node.indicator);
      if (node.compareTo) this.ensure(node.compareInstrument ?? node.instrument, node.compareTo);
    } else {
      node.children.forEach((c) => this.collect(c));
    }
  }

  /** Instruments this strategy references (so the runtime knows what to feed). */
  instruments(): string[] {
    return [...this.indicators.keys()];
  }

  /** Feed one closed bar to every indicator for the given instrument. */
  update(instrument: string, bar: Bar): void {
    const m = this.indicators.get(instrument);
    if (!m) return;
    for (const ind of m.values()) ind.update(bar);
  }

  private makeResolve(): Resolve {
    return (instrument, ref, back) => this.indicators.get(instrument)?.get(indicatorSignature(ref))?.value(back);
  }

  /**
   * Evaluate the current bar state. Returns a match ONLY on the rising edge
   * (root transitions false → true), so a strategy fires once per trigger, not
   * every bar its conditions remain satisfied.
   */
  evaluate(): StrategyMatchResult | null {
    const resolve = this.makeResolve();
    const root = this.def.root;
    const res = evaluateGroup(root, resolve);
    const rising = res.passed && !this.prevPassed;
    this.prevPassed = res.passed;
    if (!rising) return null;

    // For an OR root, report the first matching branch as the variant.
    if (root.logic === 'OR') {
      for (const child of root.children) {
        if (child.type === 'group') {
          const r = evaluateGroup(child, resolve);
          if (r.passed) return { variant: child.label ?? 'Triggered', traces: r.traces };
        } else {
          const t = evaluateCondition(child, resolve);
          if (t.passed) return { variant: 'Triggered', traces: [t] };
        }
      }
    }
    return { variant: root.label ?? 'Triggered', traces: res.traces };
  }
}
