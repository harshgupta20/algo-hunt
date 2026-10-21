/**
 * The PRODUCTION engine on verification cases — the same code the app's backtests run (prepareStock + simulate,
 * runBacktest for the figures, operandColumn for indicator values), in the output shape the checks read.
 */
import fs from 'node:fs';
import type { EqOperand, EqTrade } from '../../src/shared/equity';
import { dailyBars, weeklyBars, type Bars } from '../../src/server/equity/engine/bars';
import { prepareStock, runBacktest } from '../../src/server/equity/engine/backtest';
import { operandColumn } from '../../src/server/equity/engine/indicators';
import { simulate } from '../../src/server/equity/engine/simulate';
import { DATA_END, fileOf, type VerifyCase } from './cases';

interface Candles {
  date: string[];
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  volume: number[];
}

const files = new Map<string, Candles>();
const load = (dataDir: string, symbol: string): Candles => {
  const file = fileOf(dataDir, symbol);
  let j = files.get(file);
  if (!j) {
    j = JSON.parse(fs.readFileSync(file, 'utf8')) as Candles;
    files.set(file, j);
  }
  return j;
};

/** Daily bars of a case's stock, cut like the app does (data end, and the history it fetches). */
function bars(c: Pick<VerifyCase, 'dataDir' | 'endDate' | 'dataFrom'>, symbol: string): Bars {
  const j = load(c.dataDir, symbol);
  const rows = [];
  for (let i = 0; i < j.date.length; i++) {
    const d = j.date[i]!;
    if (d > c.endDate || (c.dataFrom && d < c.dataFrom)) continue;
    rows.push({ time: Date.parse(`${d}T00:00:00+05:30`) / 1000, open: j.open[i]!, high: j.high[i]!, low: j.low[i]!, close: j.close[i]!, volume: j.volume[i]! });
  }
  return dailyBars(rows);
}

/** Skip reasons as the checks' categories. */
const category = (reason: string) =>
  reason.startsWith('Not enough cash')
    ? 'cash'
    : reason.startsWith('Already holding')
      ? 'max'
      : reason.includes('buys 0 shares')
        ? 'size'
        : reason.startsWith('Signal at the last check') || reason.startsWith('No candle after the signal')
          ? 'end'
          : reason.includes('order lapsed')
            ? 'lapsed'
            : reason.startsWith('Locked at the upper circuit')
              ? 'circuit'
              : reason.startsWith('No trades in')
                ? 'no-trades'
                : reason.includes('at or below the new stop')
                  ? 'gap'
                  : `?${reason}`;

const tradeOut = ({ id: _id, name: _name, ...t }: EqTrade) => t;

/** Trades (every order), skipped signals and the daily account value of each case. */
export function runEngine(cases: VerifyCase[]) {
  return cases.map((c) => {
    try {
      const stocks = c.symbols.map((s) => prepareStock(c.definition, s, s, bars(c, s), c.endDate).stock);
      const r = simulate(c.definition, stocks, { from: c.from, to: c.to, capital: c.capital, maxPositions: c.maxPositions, rules: c.rules });
      return { id: c.id, trades: r.trades.map(tradeOut), skipped: r.skipped.map((s) => ({ symbol: s.symbol, date: s.date, kind: s.kind, category: category(s.reason) })), curve: r.curve };
    } catch (e) {
      return { id: c.id, error: e instanceof Error ? `${e.message}\n${e.stack}` : String(e) };
    }
  });
}

/** The results-page figures (runBacktest) next to the full daily curve and trades they come from. */
export function engineFigures(cases: VerifyCase[]) {
  return cases.map((c) => {
    const candles = c.symbols.map((s) => ({ symbol: s, name: s, daily: bars(c, s) }));
    const r = runBacktest(c.definition, { symbols: c.symbols, from: c.from, to: c.to, capital: c.capital, maxPositions: c.maxPositions }, candles, null, c.endDate, c.rules);
    const sim = simulate(c.definition, candles.map((x) => prepareStock(c.definition, x.symbol, x.symbol, x.daily, c.endDate).stock), { from: c.from, to: c.to, capital: c.capital, maxPositions: c.maxPositions, rules: c.rules });
    return {
      id: c.id,
      capital: c.capital,
      figures: { finalEquity: r.finalEquity, netPnl: r.netPnl, returnPct: r.returnPct, cagrPct: r.cagrPct, maxDrawdownPct: r.maxDrawdownPct, maxDrawdown: r.maxDrawdown, stats: r.stats, monthly: r.monthly, yearly: r.yearly, perSymbol: r.perSymbol },
      curve: sim.curve,
      trades: sim.trades.map((t) => ({
        symbol: t.symbol,
        entryDate: t.entryDate,
        exitDate: t.exitDate,
        exitReason: t.exitReason,
        // valued at the period's last close (held at the end, or a sale that waited to the end)
        endSale: t.exitReason === 'END' || t.fills.at(-1)!.reason.includes('at the last close'),
        netPnl: t.netPnl,
        returnPct: t.returnPct,
        holdingDays: t.holdingDays,
        charges: t.charges,
        adds: t.adds,
        invested: t.invested,
      })),
    };
  });
}

const I = (indicator: string, params: Record<string, number>, extra: object = {}) => ({ kind: 'INDICATOR', indicator, params, ...extra }) as EqOperand;
/** Every indicator, output, source, an MA of an indicator and a multiplier — the values conditions compare. */
export const COLUMN_OPERANDS: EqOperand[] = [
  { kind: 'PRICE', field: 'close' },
  I('SMA', { period: 20 }), I('SMA', { period: 200 }), I('SMA', { period: 20 }, { source: 'volume' }), I('SMA', { period: 10 }, { source: 'high', multiplier: 1.5 }),
  I('EMA', { period: 9 }), I('EMA', { period: 200 }), I('EMA', { period: 21 }, { source: 'low' }),
  I('WMA', { period: 5 }), I('WMA', { period: 50 }, { source: 'open' }),
  I('RSI', { period: 14 }), I('RSI', { period: 2 }), I('RSI', { period: 14 }, { source: 'high' }), I('RSI', { period: 14 }, { ma: { type: 'SMA', period: 9 } }), I('RSI', { period: 14 }, { ma: { type: 'EMA', period: 9 } }), I('RSI', { period: 7 }, { ma: { type: 'WMA', period: 5 } }),
  I('MACD', { fast: 12, slow: 26, signal: 9 }, { output: 'line' }), I('MACD', { fast: 12, slow: 26, signal: 9 }, { output: 'signal' }), I('MACD', { fast: 5, slow: 35, signal: 5 }, { output: 'hist' }),
  ...['upper', 'mid', 'lower', 'percentB', 'bandwidth'].map((output) => I('BB', { period: 20, stdDev: 2 }, { output })), I('BB', { period: 10, stdDev: 1.5 }, { output: 'lower' }),
  I('ATR', { period: 14 }), I('ATR', { period: 14 }, { ma: { type: 'SMA', period: 20 } }),
  I('SUPERTREND', { period: 10, multiplier: 3 }, { output: 'value' }), I('SUPERTREND', { period: 10, multiplier: 3 }, { output: 'direction' }), I('SUPERTREND', { period: 7, multiplier: 1.5 }, { output: 'direction' }),
  I('ADX', { period: 14, smoothing: 14 }), I('ADX', { period: 7, smoothing: 21 }, { ma: { type: 'EMA', period: 5 } }),
  I('DMI', { period: 14 }, { output: 'plus' }), I('DMI', { period: 14 }, { output: 'minus' }),
  I('HIGHEST', { period: 252 }), I('HIGHEST', { period: 20 }, { source: 'close' }), I('LOWEST', { period: 52 }), I('LOWEST', { period: 5 }, { source: 'volume' }),
  I('ROC', { period: 10 }), I('ROC', { period: 1 }, { source: 'volume' }), I('ROC', { period: 5 }, { source: 'volume', ma: { type: 'SMA', period: 10 } }),
];

/** Every operand's value on every daily and weekly candle of each stock, as JSON lines (one column per line). */
export function writeColumns(dataDir: string, symbols: string[], out: string): number {
  const fd = fs.openSync(out, 'w');
  let n = 0;
  for (const s of symbols) {
    const d = bars({ dataDir, endDate: DATA_END }, s);
    const w = weeklyBars(d, DATA_END);
    for (const [tf, b] of [['1d', d], ['1w', w]] as const)
      for (const operand of COLUMN_OPERANDS) {
        if (operand.kind === 'NUMBER') continue;
        const values = Array.from(operandColumn(b, operand), (v) => (Number.isFinite(v) ? v : null));
        fs.writeSync(fd, `${JSON.stringify({ symbol: s, tf, operand, values })}\n`);
        n++;
      }
  }
  fs.closeSync(fd);
  return n;
}
