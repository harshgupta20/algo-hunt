import { describe, expect, it } from 'vitest';
import type { StrategyDef, StrategyMarket } from '@ash/shared';
import { applyMarket, describeFixed, describeOpen, isSpecific, openFields, underlyingNotAllowed } from '@ash/shared';
import { normalizeStrategyDef } from '../src/server/db/store';
import { resolveAnalyzerParams, resolveMonitorContext } from '../src/server/services/strategy/runContext';
import { rsiSyncStrategyDef } from '../src/server/services/strategy/builtinStrategies';
import { fixtureStore } from './helpers/fixtures';

const SPECIFIC: StrategyMarket = { underlyings: ['NIFTY'], expiryType: 'current-weekly', strikeSelection: 'ATM', timeframe: '15m' };
const BASKET: StrategyMarket = { underlyings: ['NIFTY', 'BANKNIFTY'], timeframe: '5m' };
const def = (id: string, market: StrategyMarket, status: StrategyDef['status'] = 'active'): StrategyDef => ({
  ...rsiSyncStrategyDef(),
  id,
  name: id,
  builtin: false,
  status,
  market,
});

describe('market profile rules', () => {
  it('classifies specific vs universal and lists open fields', () => {
    expect(isSpecific(SPECIFIC)).toBe(true);
    expect(openFields(SPECIFIC)).toEqual([]);
    expect(isSpecific({})).toBe(false);
    expect(openFields(BASKET)).toEqual(['expiryType', 'strikeSelection']);
    expect(describeFixed(SPECIFIC)).toBe('NIFTY · Current weekly · ATM · 15m');
    expect(describeOpen(BASKET)).toBe('expiry and strike');
  });

  it('fixed fields always win over a run’s choices', () => {
    const run = { underlying: 'BANKNIFTY', expiryType: 'monthly' as const, strikeSelection: 'ATM+1' as const, timeframe: '1h' as const };
    expect(applyMarket(run, SPECIFIC)).toMatchObject({ underlying: 'NIFTY', expiryType: 'current-weekly', strikeSelection: 'ATM', timeframe: '15m' });
    // Open fields keep the run's values; a basket leaves the underlying to the caller.
    expect(applyMarket(run, BASKET)).toMatchObject({ underlying: 'BANKNIFTY', expiryType: 'monthly', timeframe: '5m' });
    expect(underlyingNotAllowed('FINNIFTY', BASKET)).toMatch(/only runs on NIFTY, BANKNIFTY/);
    expect(underlyingNotAllowed('FINNIFTY', {})).toBeUndefined();
  });

  it('legacy definitions (loose defaults) become universal so nothing that ran before changes', () => {
    const legacy = { ...def('old', {}), market: undefined, scope: 'options', underlying: 'NIFTY', expiryType: 'monthly', strikeSelection: 'ATM', timeframe: '5m' };
    const n = normalizeStrategyDef(legacy);
    expect(n.market).toEqual({});
    expect(n).not.toHaveProperty('underlying');
    expect(n).not.toHaveProperty('scope');
  });
});

describe('server enforcement', () => {
  const store = fixtureStore([def('spec', SPECIFIC), def('basket', BASKET), def('off', {}, 'disabled')]);

  it('a specific strategy backtests exactly as defined — only the date range is needed', async () => {
    const p = await resolveAnalyzerParams(store, { strategy: 'spec', preset: 'last-week' });
    expect(p).toMatchObject({ underlying: 'NIFTY', expiryType: 'current-weekly', strikeSelection: 'ATM', timeframe: '15m' });
    // Conflicting values from a client are overridden.
    const q = await resolveAnalyzerParams(store, { strategy: 'spec', preset: 'last-week', underlying: 'SENSEX', timeframe: '1h' });
    expect(q).toMatchObject({ underlying: 'NIFTY', timeframe: '15m' });
  });

  it('a basket strategy runs on all of its underlyings; a chart narrows to one member', async () => {
    const p = await resolveAnalyzerParams(store, { strategy: 'basket', preset: 'last-week', expiryType: 'monthly', strikeSelection: 'ATM' });
    expect(p.underlyings).toEqual(['NIFTY', 'BANKNIFTY']);
    expect(p.timeframe).toBe('5m');
    const c = await resolveAnalyzerParams(store, { strategy: 'basket', preset: 'last-week', underlying: 'BANKNIFTY', expiryType: 'monthly', strikeSelection: 'ATM' }, { forChart: true });
    expect(c.underlying).toBe('BANKNIFTY');
    expect(c.underlyings).toBeUndefined();
  });

  it('open fields must be supplied', async () => {
    await expect(resolveAnalyzerParams(store, { strategy: 'basket', preset: 'last-week' })).rejects.toThrow(/Choose expiry, strike/);
    await expect(resolveAnalyzerParams(store, { strategy: 'rsi-sync', preset: 'last-week', underlying: 'NIFTY' })).rejects.toThrow(/Choose expiry, strike, timeframe/);
  });

  it('monitors: fixed fields applied, other underlyings and disabled strategies refused', async () => {
    const ctx = await resolveMonitorContext(store, { strategy: 'basket', underlying: 'BANKNIFTY', expiryType: 'monthly', strikeSelection: 'ATM', timeframe: '1h' });
    expect(ctx.timeframe).toBe('5m');
    await expect(
      resolveMonitorContext(store, { strategy: 'basket', underlying: 'FINNIFTY', expiryType: 'monthly', strikeSelection: 'ATM', timeframe: '5m' }),
    ).rejects.toThrow(/only runs on/);
    await expect(
      resolveMonitorContext(store, { strategy: 'off', underlying: 'NIFTY', expiryType: 'monthly', strikeSelection: 'ATM', timeframe: '5m' }),
    ).rejects.toThrow(/disabled/);
  });
});
