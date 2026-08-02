import { format, parseISO } from 'date-fns';
import type { BacktestAlert, BacktestResult } from '@ash/shared';
import { btLegValue, btRuleLabel } from './alertView';

const HEADER = ['Date', 'Time', 'Underlying', 'Expiry', 'Strike', 'Rule', 'Future', 'Call', 'Put'];

function row(a: BacktestAlert): (string | number)[] {
  const d = parseISO(a.timestamp);
  return [
    format(d, 'yyyy-MM-dd'),
    format(d, 'HH:mm:ss'),
    a.underlying,
    a.expiry,
    a.strike,
    btRuleLabel(a),
    btLegValue(a, 'future') ?? '',
    btLegValue(a, 'call') ?? '',
    btLegValue(a, 'put') ?? '',
  ];
}

function download(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function baseName(result: BacktestResult): string {
  return `ash-analysis-${result.meta.underlying}-${result.meta.from}_${result.meta.to}`;
}

export function exportCsv(result: BacktestResult): void {
  const lines = [HEADER, ...result.alerts.map(row)].map((r) => r.join(','));
  download(`${baseName(result)}.csv`, new Blob([lines.join('\n')], { type: 'text/csv' }));
}

export function exportJson(result: BacktestResult): void {
  download(`${baseName(result)}.json`, new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }));
}

export async function exportXlsx(result: BacktestResult): Promise<void> {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();

  const alerts = wb.addWorksheet('Alerts');
  alerts.addRow(HEADER);
  alerts.getRow(1).font = { bold: true };
  result.alerts.forEach((a) => alerts.addRow(row(a)));

  const summary = wb.addWorksheet('Summary');
  const s = result.stats;
  summary.addRows([
    ['Underlying', result.meta.underlying],
    ['Expiry', result.meta.expiry],
    ['Strike', result.meta.strike],
    ['Timeframe', result.meta.timeframe],
    ['Range', `${result.meta.from} → ${result.meta.to}`],
    ['Candles analyzed', result.meta.candlesAnalyzed],
    [],
    ['Total alerts', s.totalAlerts],
    ['Scenario 1', s.scenario1],
    ['Scenario 2', s.scenario2],
    ['Avg / day', s.avgPerDay],
    ['Max / day', s.maxPerDay],
    ['Min / day', s.minPerDay],
    ['Avg / week', s.avgPerWeek],
  ]);
  summary.getColumn(1).font = { bold: true };

  const buffer = await wb.xlsx.writeBuffer();
  download(`${baseName(result)}.xlsx`, new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
}
