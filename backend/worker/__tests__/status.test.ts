/**
 * /api/status: the components are probed live on GET (memoised a minute per
 * isolate); with a database the recorded uptime history and the owner's note
 * ride along; nothing is recorded on a request, so POST is a 405.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { COMPONENTS, onRequestGet, onRequestPost, probeAll, resetStatusMemo } from '../functions/api/status';
import { resetSettingsMemo } from '../functions/_lib/settings';
import { DB_ENV, fakeDb } from './helpers/fakeDb';

let ip = 0;
const req = (): Request => new Request('https://www.vinaxmusic.online/api/status', { headers: { 'cf-connecting-ip': `10.77.0.${++ip % 250}` } });

beforeEach(() => {
  resetStatusMemo();
  resetSettingsMemo();
  vi.unstubAllGlobals();
});

describe('GET /api/status', () => {
  it('without a database: probes live, reports the API up, and carries no history', async () => {
    const fetchSpy = vi.fn(async () => new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const res = await onRequestGet({ request: req() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { overall: string; note: unknown; components: Array<{ id: string; status: string; days: unknown[]; uptime90: unknown }> };
    expect(body.overall).toBe('operational');
    expect(body.note).toBeNull();
    expect(body.components.map((c) => [c.id, c.status])).toEqual([['website', 'up'], ['api', 'up'], ['catalog', 'up'], ['admin', 'up']]);
    expect(body.components.every((c) => c.days.length === 0 && c.uptime90 === null)).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    await onRequestGet({ request: req() });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('a failing probe reads down and the overall is an outage', async () => {
    vi.stubGlobal('fetch', async (u: unknown) => (String(u).includes('jiosaavn') ? new Response('', { status: 503 }) : new Response('ok')));
    const body = (await (await onRequestGet({ request: req() })).json()) as { overall: string; components: Array<{ id: string; status: string }> };
    expect(body.components.find((c) => c.id === 'catalog')?.status).toBe('down');
    expect(body.overall).toBe('outage');
  });

  it('with a database: the recorded days, the 90-day uptime and the owner note ride along', async () => {
    const fake = fakeDb({ settings: [{ key: 'status-note', value: { text: '  Catalogue slow this evening.  ' }, updated_at: 'x', updated_by: 'owner' }] });
    fake.answer('rpc/uptime_report', () => new Response(JSON.stringify([
      { component: 'website', ok: true, latencyMs: 120, checkedAt: '2026-10-24T10:00:00Z', uptime: 99.87, days: [{ day: '2026-10-23', up: 47, total: 48 }, { day: '2026-10-24', up: 20, total: 20 }] },
      { component: 'stale-thing', ok: false, latencyMs: null, checkedAt: null, uptime: null, days: [] },
    ]), { headers: { 'content-type': 'application/json' } }));
    const body = (await (await onRequestGet({ request: req(), env: DB_ENV })).json()) as { note: string; components: Array<{ id: string; uptime90: number | null; days: Array<{ day: string; up: number; total: number }> }> };
    expect(body.note).toBe('Catalogue slow this evening.');
    const site = body.components.find((c) => c.id === 'website')!;
    expect(site.uptime90).toBe(99.87);
    expect(site.days).toEqual([{ day: '2026-10-23', up: 47, total: 48 }, { day: '2026-10-24', up: 20, total: 20 }]);
    expect(body.components.find((c) => c.id === 'api')?.days).toEqual([]);
    expect(body.components.map((c) => c.id)).toEqual(COMPONENTS.map((c) => c.id));
    expect(fake.calls.some((c) => c.table === 'rpc/uptime_report')).toBe(true);
  });

  it('probeAll is the shared probe the tick job uses: one entry per component, api up by definition', async () => {
    vi.stubGlobal('fetch', async () => new Response('ok'));
    const probes = await probeAll(Date.now(), true);
    expect([...probes.keys()].sort()).toEqual(COMPONENTS.map((c) => c.id).sort());
    expect(probes.get('api')?.ok).toBe(true);
  });
});

describe('POST /api/status', () => {
  it('is a 405: nothing is recorded on a request', async () => {
    expect((await onRequestPost()).status).toBe(405);
  });
});
