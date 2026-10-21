'use client';

/** A small chart icon that opens the stock / index on TradingView (the strategy's timeframe) in a new tab — none for
 *  the few BSE indices TradingView doesn't carry. */
import { CandlestickChart } from 'lucide-react';
import type { EqTimeframe } from '@/shared/equity';
import { Tooltip } from '../components/Tooltip';
import { tradingViewUrl } from './format';
import { E } from './help';

export function ChartLink({ symbol, tf, when }: { symbol: string; tf: EqTimeframe; when?: string }) {
  const url = tradingViewUrl(symbol, tf);
  if (!url) return null;
  return (
    <Tooltip content={{ ...E.chart, title: `${symbol} on TradingView (${tf === '1w' ? 'weekly' : 'daily'})`, ...(when ? { note: `Opens at today — scroll back to ${when}. Add the same indicators (e.g. SMA 20) to compare the values.` } : {}) }}>
      <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${symbol} on TradingView`} className="inline-flex rounded p-0.5 text-slate-500 hover:bg-ink-800 hover:text-accent-soft">
        <CandlestickChart className="w-3.5 h-3.5" />
      </a>
    </Tooltip>
  );
}
