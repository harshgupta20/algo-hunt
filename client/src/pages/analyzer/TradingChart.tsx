import { useEffect, useRef, useState } from 'react';
import {
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  type IChartApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import { Eye, EyeOff } from 'lucide-react';
import clsx from 'clsx';
import type { ChartWindow } from '@ash/shared';
import { EmptyState, Spinner } from '../../components/ui';

// Candle times are UTC epoch seconds; NSE trades in IST (UTC+5:30). Format the
// axis + crosshair in IST so candles read as 09:15–15:30, not 03:45–10:00.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function toIst(time: unknown): Date {
  return new Date((time as number) * 1000 + IST_OFFSET_MS);
}
function istHm(d: Date): string {
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
function istTick(time: unknown, tickMarkType: number): string {
  const d = toIst(time);
  // 0=Year, 1=Month, 2=DayOfMonth, 3=Time, 4=TimeWithSeconds
  return tickMarkType <= 2 ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}` : istHm(d);
}
function istTimeFormatter(time: unknown): string {
  const d = toIst(time);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${istHm(d)} IST`;
}

const DARK = {
  layout: { background: { type: ColorType.Solid, color: '#0e1420' }, textColor: '#94a3b8', fontSize: 11 },
  grid: { vertLines: { color: '#1a2233' }, horzLines: { color: '#1a2233' } },
  rightPriceScale: { borderColor: '#222c40' },
  timeScale: { borderColor: '#222c40', timeVisible: true, secondsVisible: false, tickMarkFormatter: istTick },
  crosshair: { mode: CrosshairMode.Normal },
  localization: { timeFormatter: istTimeFormatter },
};

function syncTimeScales(a: IChartApi, b: IChartApi): void {
  let guard = false;
  const link = (from: IChartApi, to: IChartApi) =>
    from.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (guard || !range) return;
      guard = true;
      to.timeScale().setVisibleLogicalRange(range);
      guard = false;
    });
  link(a, b);
  link(b, a);
}

export function TradingChart({ data, loading }: { data: ChartWindow | null; loading: boolean }) {
  const priceRef = useRef<HTMLDivElement>(null);
  const rsiRef = useRef<HTMLDivElement>(null);
  const [showRsi, setShowRsi] = useState(true);
  const [showVolume, setShowVolume] = useState(true);

  useEffect(() => {
    if (!data || !priceRef.current || data.candles.length === 0) return;
    const priceEl = priceRef.current;

    const priceChart = createChart(priceEl, { ...DARK, width: priceEl.clientWidth, height: showRsi ? 320 : 440 });
    const candle = priceChart.addCandlestickSeries({
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });
    candle.setData(
      data.candles.map((c) => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close })),
    );
    candle.setMarkers(
      data.markers.map((m) => ({
        time: m.time as UTCTimestamp,
        position: 'aboveBar' as const,
        color: m.scenario === 1 ? '#3b82f6' : '#f59e0b',
        shape: 'arrowDown' as const,
        text: `S${m.scenario}`,
      })),
    );

    if (showVolume) {
      const vol = priceChart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol' });
      priceChart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      vol.setData(
        data.candles.map((c) => ({
          time: c.time as UTCTimestamp,
          value: c.volume,
          color: c.close >= c.open ? '#22c55e55' : '#ef444455',
        })),
      );
    }
    priceChart.timeScale().fitContent();

    let rsiChart: IChartApi | undefined;
    if (showRsi && rsiRef.current) {
      const rsiEl = rsiRef.current;
      rsiChart = createChart(rsiEl, { ...DARK, width: rsiEl.clientWidth, height: 180 });
      const mkLine = (color: string) =>
        rsiChart!.addLineSeries({ color, lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
      const f = mkLine('#3b82f6');
      const c = mkLine('#22c55e');
      const p = mkLine('#f59e0b');
      f.setData(data.futureRsi.map((r) => ({ time: r.time as UTCTimestamp, value: r.value })));
      c.setData(data.callRsi.map((r) => ({ time: r.time as UTCTimestamp, value: r.value })));
      p.setData(data.putRsi.map((r) => ({ time: r.time as UTCTimestamp, value: r.value })));
      f.createPriceLine({ price: data.levels.future, color: '#3b82f6', lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: 'F/C' });
      p.createPriceLine({ price: data.levels.put, color: '#f59e0b', lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: 'P' });
      rsiChart.timeScale().fitContent();
      syncTimeScales(priceChart, rsiChart);
    }

    const onResize = () => {
      priceChart.applyOptions({ width: priceEl.clientWidth });
      if (rsiChart && rsiRef.current) rsiChart.applyOptions({ width: rsiRef.current.clientWidth });
    };
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      priceChart.remove();
      rsiChart?.remove();
    };
  }, [data, showRsi, showVolume]);

  return (
    <div className="card p-0 overflow-hidden">
      <div className="flex items-center justify-between p-3 border-b border-ink-700/60">
        <h3 className="text-sm font-semibold text-slate-300">Chart {data ? `· ${data.candles.length} candles` : ''}</h3>
        <div className="flex gap-2">
          <Toggle on={showRsi} onClick={() => setShowRsi((v) => !v)} label="RSI" />
          <Toggle on={showVolume} onClick={() => setShowVolume((v) => !v)} label="Volume" />
        </div>
      </div>
      {loading ? (
        <div className="p-6">
          <Spinner label="Loading chart window…" />
        </div>
      ) : !data || data.candles.length === 0 ? (
        <EmptyState title="Select an alert" hint="Pick an alert from the table or timeline to inspect its candle." />
      ) : (
        <div className="p-2">
          <div ref={priceRef} className="w-full" />
          {showRsi && <div ref={rsiRef} className="w-full mt-1" />}
          <div className="flex items-center gap-4 px-2 pt-1 text-[10px] text-slate-500">
            <Legend color="#3b82f6" label="Future RSI" />
            <Legend color="#22c55e" label="Call RSI" />
            <Legend color="#f59e0b" label="Put RSI" />
            <span className="ml-auto">▼ S1 blue · S2 amber · scroll to zoom, drag to pan</span>
          </div>
        </div>
      )}
    </div>
  );
}

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button className={clsx('btn-ghost py-1 px-2 text-xs', on && 'text-accent-soft')} onClick={onClick}>
      {on ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />} {label}
    </button>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="w-2.5 h-2.5 rounded-sm" style={{ background: color }} /> {label}
    </span>
  );
}
