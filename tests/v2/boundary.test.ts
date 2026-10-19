/**
 * Architecture guard: V2 is independent. It may reuse low-level building blocks
 * (indicator maths, candle helpers, Kite session / rate gate, logger, pool,
 * config, UI primitives) but never V1 business modules or MCX V2 — so either
 * can be retired without touching V2.
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

const FORBIDDEN_SERVER = [/\/mcx(\/|$)/, /services\/live\//, /services\/strategy\//, /kite\/instrumentStore/, /kite\/instrumentSync/, /strategyMarket/, /services\/history\//, /services\/notification\//, /services\/analyzer\//, /db\/store/, /db\/pg\//];

describe('V2 module boundaries', () => {
  it('shared/v2 depends on nothing but itself and zod', () => {
    for (const f of files('src/shared/v2')) for (const spec of imports(f)) expect(spec.startsWith('./') || spec === 'zod', `${relative(ROOT, f)} imports ${spec}`).toBe(true);
  });

  it('server/v2 never imports MCX V2 or V1 business modules', () => {
    const list = files('src/server/v2');
    expect(list.length).toBeGreaterThan(10);
    for (const f of list) {
      for (const spec of imports(f)) {
        expect(FORBIDDEN_SERVER.some((re) => re.test(spec)) || spec === '@ash/shared', `${relative(ROOT, f)} imports ${spec}`).toBe(false);
      }
    }
  });

  it('client/v2 only uses shared UI primitives', () => {
    for (const f of files('src/client/v2')) {
      for (const spec of imports(f)) {
        const bad = /(^|\/)(views|context|mcx)\//.test(spec) || /lib\/(strategyText|signals|alertView|api)/.test(spec) || spec === '@ash/shared' || /shared\/mcx/.test(spec);
        expect(bad, `${relative(ROOT, f)} imports ${spec}`).toBe(false);
      }
    }
  });

  it('the rest of the app imports V2 only at the wiring points', () => {
    const allowed = new Set(['src/server/api/context.ts', 'src/server/api/routes.ts', 'src/app/api/cron/tick/route.ts', 'src/server/api/controllers/v2Controller.ts', 'src/server/workers/v2Live.ts', 'src/server/background.ts']); // background: the live worker inside the app
    const others = [...files('src/server'), ...files('src/client'), ...files('src/app'), ...files('src/shared')].filter((f) => !/\/v2\//.test(relative(ROOT, f)));
    for (const f of others) {
      const rel = relative(ROOT, f);
      if (allowed.has(rel) || /components\/layout\//.test(rel)) continue;
      for (const spec of imports(f)) expect(/(server|shared|client)\/v2(\/|$)|^\.\.?\/v2(\/|$)/.test(spec), `${rel} imports ${spec}`).toBe(false);
    }
  });
});

describe('Equity module boundaries (independent of F&O / V2)', () => {
  const V2 = /(server|shared|client)\/v2(\/|$)|^\.\.?\/v2(\/|$)/;
  const EQUITY = /(server|shared|client)\/equity(\/|$)|^\.\.?\/equity(\/|$)/;

  it('shared/equity depends on nothing but itself and zod', () => {
    const list = files('src/shared/equity');
    expect(list.length).toBeGreaterThan(3);
    for (const f of list) for (const spec of imports(f)) expect(spec.startsWith('./') || spec === 'zod', `${relative(ROOT, f)} imports ${spec}`).toBe(true);
  });

  it('equity never imports V2, and V2 never imports equity', () => {
    for (const f of [...files('src/server/equity'), ...files('src/client/equity'), ...files('src/shared/equity')]) for (const spec of imports(f)) expect(V2.test(spec), `${relative(ROOT, f)} imports ${spec}`).toBe(false);
    for (const f of [...files('src/server/v2'), ...files('src/client/v2'), ...files('src/shared/v2')]) for (const spec of imports(f)) expect(EQUITY.test(spec), `${relative(ROOT, f)} imports ${spec}`).toBe(false);
  });

  it('server/equity reaches outside itself only for low-level building blocks', () => {
    const list = files('src/server/equity');
    expect(list.length).toBeGreaterThan(8);
    const own = join(ROOT, 'src/server/equity');
    const buildingBlocks = ['src/server/services/indicator/rsi', 'src/server/services/indicator/types', 'src/server/utils/logger', 'src/server/db/pool', 'src/server/config/index'].map((p) => join(ROOT, p));
    for (const f of list) {
      for (const spec of imports(f)) {
        let ok: boolean;
        if (spec.startsWith('.')) {
          const target = join(f, '..', spec);
          ok = target.startsWith(own) || buildingBlocks.includes(target);
        } else ok = spec === '@/shared/equity' || spec === 'pg' || spec === 'zod' || spec.startsWith('node:');
        expect(ok, `${relative(ROOT, f)} imports ${spec}`).toBe(true);
      }
    }
  });
});
