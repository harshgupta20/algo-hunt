/**
 * Architecture guard: MCX V2 is an isolated subsystem. It may reuse low-level
 * building blocks (indicator math, candle helpers, Kite session/rate gate,
 * logger, pool, config, UI primitives) but never V1 business modules — and V1
 * never imports V2 except at the wiring points.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');

function files(dir: string): string[] {
  const abs = join(ROOT, dir);
  try {
    statSync(abs);
  } catch {
    return [];
  }
  return readdirSync(abs, { recursive: true, encoding: 'utf8' })
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => join(abs, f));
}

function imports(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  return [...src.matchAll(/(?:import|export)[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1] ?? m[2]!);
}

const V1_BUSINESS = [/services\/live\//, /services\/strategy\//, /kite\/instrumentStore/, /kite\/instrumentSync/, /strategyMarket/, /services\/mcx\//, /services\/history\//, /services\/notification\//, /services\/analyzer\//, /db\/store/, /db\/pg\//];

describe('MCX V2 module boundaries', () => {
  it('shared/mcx depends on nothing but itself and zod', () => {
    for (const f of files('src/shared/mcx')) {
      for (const spec of imports(f)) expect(spec.startsWith('./') || spec === 'zod', `${relative(ROOT, f)} imports ${spec}`).toBe(true);
    }
  });

  it('server/mcx never imports V1 business modules', () => {
    const list = files('src/server/mcx');
    expect(list.length).toBeGreaterThan(10);
    for (const f of list) {
      for (const spec of imports(f)) {
        expect(V1_BUSINESS.some((re) => re.test(spec)), `${relative(ROOT, f)} imports ${spec}`).toBe(false);
        expect(spec === '@ash/shared', `${relative(ROOT, f)} imports the V1 shared barrel`).toBe(false);
      }
    }
  });

  it('client/mcx only uses shared UI primitives from V1', () => {
    for (const f of files('src/client/mcx')) {
      for (const spec of imports(f)) {
        const v1Client = /(^|\/)(views|context)\//.test(spec) || /lib\/(strategyText|signals|alertView)/.test(spec);
        expect(v1Client || spec === '@ash/shared', `${relative(ROOT, f)} imports ${spec}`).toBe(false);
      }
    }
  });

  it('V1 code imports V2 only at the wiring points', () => {
    const allowed = new Set(['src/server/api/context.ts', 'src/server/api/routes.ts', 'src/app/api/cron/tick/route.ts']);
    const v1 = [...files('src/server'), ...files('src/client'), ...files('src/app')].filter((f) => !/\/mcx\//.test(relative(ROOT, f)) && !/mcx-v2/.test(f));
    for (const f of v1) {
      const rel = relative(ROOT, f);
      if (allowed.has(rel) || /controllers\/mcxV2Controller\.ts$/.test(rel) || /components\/layout\//.test(rel)) continue;
      for (const spec of imports(f)) expect(/(server|shared|client)\/mcx(\/|$)|^\.\.?\/mcx\//.test(spec), `${rel} imports ${spec}`).toBe(false);
    }
  });
});
