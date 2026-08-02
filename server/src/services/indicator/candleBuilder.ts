/**
 * Aggregates ticks into OHLC candles for a single instrument + timeframe.
 *
 * A candle is finalized ("closed") when a tick arrives whose bucket is later
 * than the forming candle's bucket. Because we evaluate strategies only on
 * closed candles, `update()` surfaces the just-closed candle when a rollover
 * happens so callers can react to confirmed data.
 */
import type { Candle, Tick, Timeframe } from '@ash/shared';
import { bucketStart } from '../../utils/time.js';

function newCandle(token: number, timeframe: Timeframe, bucket: number, price: number): Candle {
  return { token, timeframe, bucket, open: price, high: price, low: price, close: price, closed: false };
}

export class CandleBuilder {
  private forming: Candle | undefined;

  constructor(
    private readonly token: number,
    private readonly timeframe: Timeframe,
  ) {}

  /** The current (unclosed) forming candle, if any. */
  get current(): Candle | undefined {
    return this.forming;
  }

  /**
   * Apply a tick. Returns the candle that just closed, if this tick rolled the
   * builder into a new bucket; otherwise undefined.
   */
  update(tick: Tick): { closed?: Candle } {
    const bucket = bucketStart(tick.timestamp, this.timeframe);

    if (!this.forming) {
      this.forming = newCandle(this.token, this.timeframe, bucket, tick.ltp);
      return {};
    }

    if (bucket === this.forming.bucket) {
      this.forming.high = Math.max(this.forming.high, tick.ltp);
      this.forming.low = Math.min(this.forming.low, tick.ltp);
      this.forming.close = tick.ltp;
      return {};
    }

    if (bucket < this.forming.bucket) {
      // Out-of-order tick for an already-passed bucket; ignore it.
      return {};
    }

    const closed: Candle = { ...this.forming, closed: true };
    this.forming = newCandle(this.token, this.timeframe, bucket, tick.ltp);
    return { closed };
  }
}
