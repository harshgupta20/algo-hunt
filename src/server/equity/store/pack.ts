/**
 * Backtest results are kept gzipped: a busy 10-year run on 136 stocks is ~19 MB of JSON but ~2.3 MB packed, a
 * typical one ~0.05 MB. Results over MAX_KEPT_BYTES packed aren't kept (the history line still is).
 */
import { promisify } from 'node:util';
import { gunzip, gzip } from 'node:zlib';
import type { EqBacktestResult } from '@/shared/equity';

const zip = promisify(gzip);
const unzip = promisify(gunzip);

export const MAX_KEPT_BYTES = 25 * 1024 * 1024;

export async function packResult(result: EqBacktestResult): Promise<Buffer> {
  return zip(JSON.stringify(result), { level: 6 });
}

export async function unpackResult(packed: Buffer): Promise<EqBacktestResult> {
  return JSON.parse((await unzip(packed)).toString('utf8')) as EqBacktestResult;
}
