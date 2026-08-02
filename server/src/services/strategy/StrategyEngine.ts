/**
 * Pluggable strategy registry. New strategies register here and become
 * available to the worker and API without touching either — the codebase is
 * meant to grow strategies, not rewrite the pipeline.
 */
import type { Strategy, StrategyContext, StrategyKey, StrategyMatch } from '@ash/shared';
import { RsiSyncStrategy } from './rsiSyncStrategy.js';

export class StrategyEngine {
  private readonly strategies = new Map<StrategyKey, Strategy>();

  register(strategy: Strategy): void {
    this.strategies.set(strategy.definition.key, strategy);
  }

  get(key: StrategyKey | string): Strategy | undefined {
    return this.strategies.get(key as StrategyKey);
  }

  list(): Strategy[] {
    return [...this.strategies.values()];
  }

  /** Evaluate a built-in strategy by key; returns null for unknown/custom keys. */
  evaluate(key: StrategyKey | string, ctx: StrategyContext): StrategyMatch | null {
    const strategy = this.strategies.get(key as StrategyKey);
    if (!strategy) return null;
    return strategy.evaluate(ctx);
  }
}

/** Build the default engine with all built-in strategies registered. */
export function createStrategyEngine(): StrategyEngine {
  const engine = new StrategyEngine();
  engine.register(new RsiSyncStrategy());
  return engine;
}
