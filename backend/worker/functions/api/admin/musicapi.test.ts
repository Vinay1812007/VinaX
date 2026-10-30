import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequestGet, parseWrapperHealth } from './musicapi';

const ADMIN = { ADMIN_LOGIN_PASSWORD: 'test-secret' };
const req = () =>
  new Request('https://admin.test/api/admin/musicapi', {
    headers: { 'x-admin-token': 'test-secret', 'cf-connecting-ip': '10.77.0.1' },
  });
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('parseWrapperHealth', () => {
  it('keeps each upstream’s name, state and latency, and never its error text', () => {
    const h = parseWrapperHealth({
      success: true,
      data: {
        status: 'degraded',
        jiosaavn: { configured: true, ok: true, latencyMs: 70.4, error: null },
        relay: { configured: true, ok: false, latencyMs: null, error: 'upstream said <html>secret</html>' },
        checkedAt: '2026-10-30T00:00:00Z',
      },
    });
    expect(h).toEqual({
      status: 'degraded',
      upstreams: [
        { name: 'jiosaavn', configured: true, ok: true, latencyMs: 70 },
        { name: 'relay', configured: true, ok: false, latencyMs: null },
      ],
    });
    expect(JSON.stringify(h)).not.toContain('secret');
  });

  it('answers null for anything that is not a health report', () => {
    expect(parseWrapperHealth(null)).toBeNull();
    expect(parseWrapperHealth({ data: { ok: true } })).toBeNull();
    expect(parseWrapperHealth('<html>')).toBeNull();
  });
});

describe('/api/admin/musicapi', () => {
  const calls: string[] = [];
  beforeEach(() => {
    calls.length = 0;
    vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      calls.push(url);
      if (url === 'https://w.example/api/health') {
        return Promise.resolve(json({ success: true, data: { status: 'ok', jiosaavn: { configured: true, ok: true, latencyMs: 50 } } }));
      }
      if (url.startsWith('https://w.example/api/search/songs')) return Promise.resolve(json({ data: { results: [{ id: 'x' }] } }));
      return Promise.resolve(json({ results: [] }));
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('reports each wrapper’s own /health next to its search check', async () => {
    const res = await onRequestGet({ request: req(), env: { ...ADMIN, CATALOG_UPSTREAMS: 'https://w.example/api' } as never });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { mirrors: Array<{ id: string; ok: boolean; songs: number; health?: unknown }> };
    const wrapper = body.mirrors.find((m) => m.id === 'upstream-1');
    expect(wrapper).toMatchObject({ ok: true, songs: 1, health: { status: 'ok', upstreams: [{ name: 'jiosaavn', ok: true, latencyMs: 50 }] } });
    expect(calls).toContain('https://w.example/api/health');
    // The in-process and direct checks have no wrapper health.
    expect(body.mirrors.find((m) => m.id === 'direct')?.health).toBeUndefined();
  });

  it('refuses a non-admin', async () => {
    const res = await onRequestGet({ request: new Request('https://admin.test/api/admin/musicapi'), env: ADMIN as never });
    expect(res.status).toBe(401);
  });
});
