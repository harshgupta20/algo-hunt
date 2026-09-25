/**
 * Concrete streaming indicators. Adding a new indicator = add a class here and
 * one line in the registry; the builder UI picks it up from the catalog.
 */
import { MAX_PATTERN_BARS, PATTERN_BY_ID } from './patterns';
import { RsiCalculator } from './rsi';
import { BaseIndicator, Ema, Rma, param, type Bar } from './types';

class RsiIndicator extends BaseIndicator {
  private readonly calc = new RsiCalculator(param(this.ref, 'period', 14));
  protected compute(bar: Bar): number | undefined {
    return this.calc.update(bar.close);
  }
}

class EmaIndicator extends BaseIndicator {
  private readonly ema = new Ema(param(this.ref, 'period', 20));
  protected compute(bar: Bar): number | undefined {
    return this.ema.push(bar.close);
  }
}

class SmaIndicator extends BaseIndicator {
  private readonly period = param(this.ref, 'period', 20);
  private readonly window: number[] = [];
  private sum = 0;
  protected compute(bar: Bar): number | undefined {
    this.window.push(bar.close);
    this.sum += bar.close;
    if (this.window.length > this.period) this.sum -= this.window.shift()!;
    return this.window.length === this.period ? this.sum / this.period : undefined;
  }
}

class VwapIndicator extends BaseIndicator {
  private cumPV = 0;
  private cumV = 0;
  private day: string | undefined;
  protected compute(bar: Bar): number | undefined {
    const d = new Date(bar.time * 1000).toISOString().slice(0, 10);
    if (this.day !== d) {
      this.day = d;
      this.cumPV = 0;
      this.cumV = 0;
    }
    const typical = (bar.high + bar.low + bar.close) / 3;
    this.cumPV += typical * bar.volume;
    this.cumV += bar.volume;
    return this.cumV > 0 ? this.cumPV / this.cumV : bar.close;
  }
}

class MacdIndicator extends BaseIndicator {
  private readonly field = this.ref.field ?? 'line';
  private readonly emaFast = new Ema(param(this.ref, 'fast', 12));
  private readonly emaSlow = new Ema(param(this.ref, 'slow', 26));
  private readonly emaSignal = new Ema(param(this.ref, 'signal', 9));
  protected compute(bar: Bar): number | undefined {
    const f = this.emaFast.push(bar.close);
    const s = this.emaSlow.push(bar.close);
    if (f === undefined || s === undefined) return undefined;
    const macd = f - s;
    const signal = this.emaSignal.push(macd);
    if (this.field === 'line') return macd;
    if (signal === undefined) return undefined;
    return this.field === 'signal' ? signal : macd - signal;
  }
}

class BollingerIndicator extends BaseIndicator {
  private readonly period = param(this.ref, 'period', 20);
  private readonly mult = param(this.ref, 'mult', 2);
  private readonly field = this.ref.field ?? 'mid';
  private readonly window: number[] = [];
  protected compute(bar: Bar): number | undefined {
    this.window.push(bar.close);
    if (this.window.length > this.period) this.window.shift();
    if (this.window.length < this.period) return undefined;
    const mean = this.window.reduce((a, b) => a + b, 0) / this.period;
    const variance = this.window.reduce((a, b) => a + (b - mean) ** 2, 0) / this.period;
    const std = Math.sqrt(variance);
    if (this.field === 'upper') return mean + this.mult * std;
    if (this.field === 'lower') return mean - this.mult * std;
    return mean;
  }
}

class SupertrendIndicator extends BaseIndicator {
  private readonly period = param(this.ref, 'period', 10);
  private readonly mult = param(this.ref, 'mult', 3);
  private readonly field = this.ref.field ?? 'value';
  private prevClose: number | undefined;
  private atr: number | undefined;
  private trSeed: number[] = [];
  private finalUpper: number | undefined;
  private finalLower: number | undefined;
  private supertrend: number | undefined;
  private dir = 1;

  protected compute(bar: Bar): number | undefined {
    const { high, low, close } = bar;
    const tr =
      this.prevClose === undefined
        ? high - low
        : Math.max(high - low, Math.abs(high - this.prevClose), Math.abs(low - this.prevClose));

    if (this.atr === undefined) {
      this.trSeed.push(tr);
      if (this.trSeed.length < this.period) {
        this.prevClose = close;
        return undefined;
      }
      this.atr = this.trSeed.reduce((a, b) => a + b, 0) / this.period;
    } else {
      this.atr = (this.atr * (this.period - 1) + tr) / this.period;
    }

    const hl2 = (high + low) / 2;
    const basicUpper = hl2 + this.mult * this.atr;
    const basicLower = hl2 - this.mult * this.atr;
    const prevUpper = this.finalUpper ?? basicUpper;
    const prevLower = this.finalLower ?? basicLower;
    const pc = this.prevClose ?? close;

    const finalUpper = basicUpper < prevUpper || pc > prevUpper ? basicUpper : prevUpper;
    const finalLower = basicLower > prevLower || pc < prevLower ? basicLower : prevLower;

    if (this.supertrend === undefined) {
      this.supertrend = finalUpper;
      this.dir = -1;
    } else if (this.supertrend === prevUpper) {
      this.dir = close <= finalUpper ? -1 : 1;
      this.supertrend = this.dir === -1 ? finalUpper : finalLower;
    } else {
      this.dir = close >= finalLower ? 1 : -1;
      this.supertrend = this.dir === 1 ? finalLower : finalUpper;
    }

    this.finalUpper = finalUpper;
    this.finalLower = finalLower;
    this.prevClose = close;
    return this.field === 'direction' ? this.dir : this.supertrend;
  }
}

class PriceIndicator extends BaseIndicator {
  private readonly field = this.ref.field ?? 'close';
  protected compute(bar: Bar): number | undefined {
    switch (this.field) {
      case 'open':
        return bar.open;
      case 'high':
        return bar.high;
      case 'low':
        return bar.low;
      default:
        return bar.close;
    }
  }
}

class VolumeIndicator extends BaseIndicator {
  protected compute(bar: Bar): number {
    return bar.volume;
  }
}

class OiIndicator extends BaseIndicator {
  protected compute(bar: Bar): number {
    return bar.oi ?? 0;
  }
}

/**
 * Wilder's directional movement (as TradingView's DMI): +DM / −DM and true
 * range from consecutive candles, each smoothed with RMA(period);
 * +DI = 100·RMA(+DM)/RMA(TR), −DI = 100·RMA(−DM)/RMA(TR).
 */
class DirectionalMovement {
  private prev: Bar | undefined;
  private readonly tr: Rma;
  private readonly plusDm: Rma;
  private readonly minusDm: Rma;

  constructor(period: number) {
    this.tr = new Rma(period);
    this.plusDm = new Rma(period);
    this.minusDm = new Rma(period);
  }

  push(bar: Bar): { plus: number; minus: number } | undefined {
    const prev = this.prev;
    this.prev = bar;
    if (!prev) return undefined;
    const up = bar.high - prev.high;
    const down = prev.low - bar.low;
    const tr = Math.max(bar.high - bar.low, Math.abs(bar.high - prev.close), Math.abs(bar.low - prev.close));
    const atr = this.tr.push(tr);
    const p = this.plusDm.push(up > down && up > 0 ? up : 0);
    const m = this.minusDm.push(down > up && down > 0 ? down : 0);
    if (atr === undefined || p === undefined || m === undefined) return undefined;
    if (atr === 0) return { plus: 0, minus: 0 };
    return { plus: (100 * p) / atr, minus: (100 * m) / atr };
  }
}

class DmiIndicator extends BaseIndicator {
  private readonly dm = new DirectionalMovement(param(this.ref, 'period', 14));
  private readonly field = this.ref.field ?? 'plus';
  protected compute(bar: Bar): number | undefined {
    const di = this.dm.push(bar);
    if (!di) return undefined;
    return this.field === 'minus' ? di.minus : di.plus;
  }
}

/** ADX = RMA(smoothing) of DX, where DX = 100·|+DI − −DI| / (+DI + −DI). */
class AdxIndicator extends BaseIndicator {
  private readonly dm = new DirectionalMovement(param(this.ref, 'period', 14));
  private readonly adx = new Rma(param(this.ref, 'smoothing', 14));
  protected compute(bar: Bar): number | undefined {
    const di = this.dm.push(bar);
    if (!di) return undefined;
    const sum = di.plus + di.minus;
    return this.adx.push((100 * Math.abs(di.plus - di.minus)) / (sum === 0 ? 1 : sum));
  }
}

/** 1 when the selected candlestick pattern completes on this candle, else 0. */
class PatternIndicator extends BaseIndicator {
  private readonly pattern = PATTERN_BY_ID[this.ref.field ?? 'anyBullish'] ?? PATTERN_BY_ID.anyBullish!;
  private readonly recent: Bar[] = [];
  protected compute(bar: Bar): number | undefined {
    this.recent.push(bar);
    if (this.recent.length > MAX_PATTERN_BARS) this.recent.shift();
    if (this.recent.length < this.pattern.bars) return undefined;
    return this.pattern.detect(this.recent) ? 1 : 0;
  }
}

export const INDICATOR_CLASSES = {
  RSI: RsiIndicator,
  EMA: EmaIndicator,
  SMA: SmaIndicator,
  VWAP: VwapIndicator,
  MACD: MacdIndicator,
  BBANDS: BollingerIndicator,
  SUPERTREND: SupertrendIndicator,
  PRICE: PriceIndicator,
  VOLUME: VolumeIndicator,
  OI: OiIndicator,
  ADX: AdxIndicator,
  DMI: DmiIndicator,
  PATTERN: PatternIndicator,
} as const;
