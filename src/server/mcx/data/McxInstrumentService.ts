/**
 * MCX V2's own instrument universe (mcx_instruments), synced from the data
 * provider. Kite republishes the master daily, so a scan re-syncs when the
 * stored copy is older than MAX_AGE_MS. Cached per serverless instance briefly.
 */
import type { McxInstrument } from '@/shared/mcx';
import { childLogger } from '../../utils/logger';
import type { McxStore } from '../persistence/McxStore';
import type { McxDataProvider } from './McxDataProvider';

const log = childLogger('mcx-v2-instruments');
export const MAX_AGE_MS = 18 * 60 * 60_000;
const CACHE_MS = 60_000;

export class McxInstrumentService {
  private cache?: { at: number; list: McxInstrument[]; byId: Map<string, McxInstrument> };

  constructor(
    private readonly store: McxStore,
    private readonly provider: McxDataProvider,
  ) {}

  invalidate(): void {
    this.cache = undefined;
  }

  async list(now = Date.now()): Promise<McxInstrument[]> {
    if (!this.cache || now - this.cache.at > CACHE_MS) {
      const list = await this.store.instruments.list();
      this.cache = { at: now, list, byId: new Map(list.map((i) => [i.id, i])) };
    }
    return this.cache.list;
  }

  async byId(id: string): Promise<McxInstrument | undefined> {
    await this.list();
    return this.cache?.byId.get(id);
  }

  async sync(): Promise<{ count: number; syncedAt: string }> {
    const list = await this.provider.getInstruments();
    if (!list.length) throw new Error('The data provider returned no MCX futures/options for the supported products');
    await this.store.instruments.replaceAll(list);
    this.invalidate();
    log.info({ count: list.length }, 'mcx v2 instruments synced');
    return { count: list.length, syncedAt: new Date().toISOString() };
  }

  /** Sync when never synced or stale. Returns a note when it synced. */
  async ensureFresh(now = Date.now()): Promise<string | undefined> {
    const at = await this.store.instruments.syncedAt();
    if (at && now - Date.parse(at) < MAX_AGE_MS) return undefined;
    const { count } = await this.sync();
    return `Instrument master ${at ? 'refreshed' : 'synced'} (${count} contracts)`;
  }
}
