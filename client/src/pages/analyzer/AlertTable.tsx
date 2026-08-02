import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Search } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import clsx from 'clsx';
import type { BacktestAlert } from '@ash/shared';
import { EmptyState, RuleBadge } from '../../components/ui';
import { fmtRsi } from '../../lib/format';
import { btLegValue } from '../../lib/alertView';

type SortKey = 'time' | 'scenario' | 'future' | 'call' | 'put';
const PAGE_SIZE = 12;

function valueOf(a: BacktestAlert, key: SortKey): number {
  switch (key) {
    case 'time':
      return a.bucket;
    case 'scenario':
      return a.scenario ?? 0;
    case 'future':
      return btLegValue(a, 'future') ?? 0;
    case 'call':
      return btLegValue(a, 'call') ?? 0;
    case 'put':
      return btLegValue(a, 'put') ?? 0;
  }
}

export function AlertTable({
  alerts,
  onSelect,
  selectedId,
}: {
  alerts: BacktestAlert[];
  onSelect: (a: BacktestAlert) => void;
  selectedId?: string;
}) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('time');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = q
      ? alerts.filter((a) =>
          [a.underlying, a.expiry, `scenario ${a.scenario}`, String(a.strike)]
            .join(' ')
            .toLowerCase()
            .includes(q),
        )
      : alerts;
    const sorted = [...rows].sort((a, b) => {
      const d = valueOf(a, sortKey) - valueOf(b, sortKey);
      return sortDir === 'asc' ? d : -d;
    });
    return sorted;
  }, [alerts, search, sortKey, sortDir]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const clampedPage = Math.min(page, pages - 1);
  const rows = filtered.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const Th = ({ label, k, align = 'left' }: { label: string; k: SortKey; align?: 'left' | 'right' }) => (
    <th className={clsx('px-3 py-2 cursor-pointer select-none', align === 'right' && 'text-right')} onClick={() => toggleSort(k)}>
      <span className={clsx('inline-flex items-center gap-1', align === 'right' && 'flex-row-reverse')}>
        {label}
        {sortKey === k && (sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
      </span>
    </th>
  );

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between gap-3 p-3 border-b border-ink-700/60">
        <h3 className="text-sm font-semibold text-slate-300">Historical Alerts ({filtered.length})</h3>
        <div className="relative">
          <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            className="input pl-8 py-1.5 text-xs w-48"
            placeholder="Search…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No alerts" hint="No alerts match the current filters." />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500 bg-ink-850">
                <tr>
                  <Th label="Date / Time" k="time" />
                  <th className="px-3 py-2">Underlying</th>
                  <th className="px-3 py-2">Expiry</th>
                  <th className="px-3 py-2">Strike</th>
                  <Th label="Scenario" k="scenario" />
                  <Th label="Future" k="future" align="right" />
                  <Th label="Call" k="call" align="right" />
                  <Th label="Put" k="put" align="right" />
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-700/50">
                {rows.map((a) => (
                  <tr
                    key={a.id}
                    onClick={() => onSelect(a)}
                    className={clsx('cursor-pointer hover:bg-ink-850/60', selectedId === a.id && 'bg-accent/10')}
                  >
                    <td className="px-3 py-2 whitespace-nowrap text-slate-300">
                      {format(parseISO(a.timestamp), 'dd MMM yy · HH:mm')}
                    </td>
                    <td className="px-3 py-2 text-white font-medium">{a.underlying}</td>
                    <td className="px-3 py-2 text-slate-400">{a.expiry}</td>
                    <td className="px-3 py-2 tabular-nums">{a.strike}</td>
                    <td className="px-3 py-2">
                      <RuleBadge scenario={a.scenario} variant={a.variant} />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-bull">{fmtRsi(btLegValue(a, 'future'))}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-bull">{fmtRsi(btLegValue(a, 'call'))}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-bear">{fmtRsi(btLegValue(a, 'put'))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between p-3 text-xs text-slate-400">
            <span>
              Page {clampedPage + 1} of {pages}
            </span>
            <div className="flex gap-2">
              <button className="btn-ghost py-1 px-2" disabled={clampedPage === 0} onClick={() => setPage(clampedPage - 1)}>
                Prev
              </button>
              <button className="btn-ghost py-1 px-2" disabled={clampedPage >= pages - 1} onClick={() => setPage(clampedPage + 1)}>
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
