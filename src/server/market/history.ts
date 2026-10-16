/**
 * FII / DII history. NSE only publishes the latest day, so each day seen is kept in a small JSON file next to the
 * app's other local data (data/market-history.json) — never in the database.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Flow } from '@/shared/market/types';
import { childLogger } from '../utils/logger';

const log = childLogger('market');
const KEEP_DAYS = 120;

export function historyFile(): string {
  // Beside the waiting-records file (the desktop app points that at its data folder).
  const pending = process.env.PENDING_WRITES_FILE?.trim() || 'data/pending-writes.json';
  return process.env.MARKET_HISTORY_FILE?.trim() || path.join(path.dirname(pending), 'market-history.json');
}

interface HistoryFile {
  flows: Flow[];
}

function read(file: string): HistoryFile {
  try {
    if (!existsSync(file)) return { flows: [] };
    const h = JSON.parse(readFileSync(file, 'utf8')) as Partial<HistoryFile>;
    return { flows: Array.isArray(h.flows) ? h.flows : [] };
  } catch {
    return { flows: [] };
  }
}

/** Adds (or replaces) `flow`'s day; returns the history newest first. */
export function rememberFlow(flow: Flow | null, file = historyFile()): Flow[] {
  const h = read(file);
  if (flow?.date) {
    const others = h.flows.filter((f) => f.date !== flow.date);
    const next = [flow, ...others].sort((a, b) => b.date.localeCompare(a.date)).slice(0, KEEP_DAYS);
    const changed = JSON.stringify(next) !== JSON.stringify(h.flows);
    h.flows = next;
    if (changed) {
      try {
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(`${file}.tmp`, JSON.stringify(h));
        renameSync(`${file}.tmp`, file);
      } catch (err) {
        log.warn({ file, error: err instanceof Error ? err.message : String(err) }, 'could not save the FII / DII history');
      }
    }
  }
  return h.flows;
}
