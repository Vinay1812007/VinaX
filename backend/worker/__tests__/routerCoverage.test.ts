/**
 * v5.11.3 — router coverage.
 *
 * worker/index.ts is a HAND-MAINTAINED router: every handler under
 * functions/api needs both an `import * as m_… from './functions/api/…'` and
 * an entry in the EXACT path map. A handler with neither is silently dead —
 * the router falls through to `passthrough()`, the request is proxied to the
 * Pages origin, and a POST comes back 405 with the app's headers.
 *
 * That is exactly how /api/preview shipped broken in v5.11.2, and CI could not
 * see it: `wrangler deploy --dry-run` builds the bundle and never notices that
 * a module in the tree is unreachable. This test does.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const WORKER_DIR = join(__dirname, '..');
const API_DIR = join(WORKER_DIR, 'functions', 'api');
const index = readFileSync(join(WORKER_DIR, 'index.ts'), 'utf8');

/** Every non-test handler file under functions/api, as a route path. */
function handlerRoutes(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      handlerRoutes(full, acc);
      continue;
    }
    if (!entry.name.endsWith('.ts')) continue;
    if (entry.name.endsWith('.test.ts')) continue;
    // Dynamic / catch-all segments ([id], [[path]]) are routed by the DYNAMIC
    // list and the explicit /api/cat branch, not by the EXACT map.
    if (entry.name.includes('[')) continue;
    const rel = relative(API_DIR, full).split(sep).join('/');
    acc.push(`/api/${rel.replace(/\.ts$/, '')}`);
  }
  return acc;
}

describe('worker router coverage', () => {
  const routes = handlerRoutes(API_DIR).sort();
  const exactKeys = new Set([...index.matchAll(/'(\/api\/[^']+)':/g)].map((m) => m[1]));

  it('finds the api handlers at all (guards against a bad glob silently passing)', () => {
    expect(routes.length).toBeGreaterThan(30);
    expect(routes).toContain('/api/preview');
    expect(routes).toContain('/api/vinaxai');
  });

  it('every functions/api handler has an EXACT route entry in index.ts', () => {
    const orphans = routes.filter((r) => !exactKeys.has(r));
    expect(orphans, `unreachable handler(s) — add an import AND an EXACT entry in worker/index.ts for: ${orphans.join(', ')}`).toEqual([]);
  });

  it('every EXACT /api entry has a real handler file behind it', () => {
    const known = new Set(routes);
    const dangling = [...exactKeys].filter((k) => !known.has(k));
    expect(dangling, `EXACT entries with no handler file: ${dangling.join(', ')}`).toEqual([]);
  });

  it('each routed handler is also imported (an EXACT entry alone will not compile)', () => {
    for (const r of routes) {
      const modulePath = `./functions${r}`;
      expect(index, `missing import for ${r}`).toContain(`from '${modulePath}'`);
    }
  });
});
