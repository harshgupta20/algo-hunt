/**
 * Wilder's Relative Strength Index (RSI).
 *
 * Implemented incrementally: each closed candle updates the smoothed average
 * gain/loss in O(1), so we never recompute over the full candle history
 * (a stated performance requirement). Warmup needs `period + 1` closes before
 * the first RSI value is produced.
 */

export class RsiCalculator {
  private readonly period: number;
  private prevClose: number | undefined;
  private avgGain = 0;
  private avgLoss = 0;
  private readonly seedChanges: number[] = [];
  private seeded = false;
  private current: number | undefined;

  constructor(period: number) {
    if (!Number.isInteger(period) || period < 1) {
      throw new Error(`RSI period must be a positive integer, got ${period}`);
    }
    this.period = period;
  }

  /** The most recent RSI value, or undefined during warmup. */
  get value(): number | undefined {
    return this.current;
  }

  /** True once enough data exists to produce RSI values. */
  get ready(): boolean {
    return this.seeded;
  }

  /**
   * Feed the next *closed* candle close. Returns the current RSI (or undefined
   * while still warming up).
   */
  update(close: number): number | undefined {
    if (this.prevClose === undefined) {
      this.prevClose = close;
      return this.current;
    }

    const change = close - this.prevClose;
    this.prevClose = close;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;

    if (!this.seeded) {
      this.seedChanges.push(change);
      if (this.seedChanges.length === this.period) {
        let g = 0;
        let l = 0;
        for (const c of this.seedChanges) {
          if (c > 0) g += c;
          else l += -c;
        }
        this.avgGain = g / this.period;
        this.avgLoss = l / this.period;
        this.seeded = true;
        this.current = rsiFromAverages(this.avgGain, this.avgLoss);
      }
      return this.current;
    }

    this.avgGain = (this.avgGain * (this.period - 1) + gain) / this.period;
    this.avgLoss = (this.avgLoss * (this.period - 1) + loss) / this.period;
    this.current = rsiFromAverages(this.avgGain, this.avgLoss);
    return this.current;
  }

  /**
   * Compute the RSI that *would* result from `close` without mutating state.
   * Used for live display gauges on the still-forming candle; strategy
   * evaluation always uses the committed value from update() on a closed candle.
   */
  peek(close: number): number | undefined {
    if (this.prevClose === undefined) return undefined;
    const change = close - this.prevClose;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;

    if (!this.seeded) {
      if (this.seedChanges.length + 1 < this.period) return undefined;
      let g = 0;
      let l = 0;
      for (const c of this.seedChanges) {
        if (c > 0) g += c;
        else l += -c;
      }
      if (change > 0) g += change;
      else l += -change;
      return rsiFromAverages(g / this.period, l / this.period);
    }

    const ag = (this.avgGain * (this.period - 1) + gain) / this.period;
    const al = (this.avgLoss * (this.period - 1) + loss) / this.period;
    return rsiFromAverages(ag, al);
  }
}

/** Convert smoothed average gain/loss into an RSI value in [0, 100]. */
export function rsiFromAverages(avgGain: number, avgLoss: number): number {
  // No losses over the window => maximally strong => 100. Also covers the
  // flat (gain == loss == 0) case, treated as 100 by convention.
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * Batch helper: compute the RSI series for an array of closes. Entries are
 * undefined during warmup. Primarily used for tests and historical seeding.
 */
export function computeRsiSeries(closes: number[], period: number): (number | undefined)[] {
  const calc = new RsiCalculator(period);
  return closes.map((c) => calc.update(c));
}
