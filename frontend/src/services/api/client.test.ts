// @vitest-environment jsdom
/**
 * Pins the boot-prefetch contract (4.18.2): index.html parks the cold-load
 * trending request on window.__vxBoot; the orchestrator consumes it by exact
 * URL match, exactly once, and falls back to the network on any miss or a
 * null payload (upstream failure). See index.html + takeBootPrefetch().
 * v5.6.7: URLs track the FIRST ranked base — now the VinaX Saavn API.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { orchestratedRequest } from './client';

interface BootWindow {
  __vxBoot?: { url: string; json: Promise<unknown> } | null;
}
const w = window as unknown as BootWindow;

afterEach(() => {
  w.__vxBoot = null;
  vi.unstubAllGlobals();
});

describe('boot prefetch consumption', () => {
  it('serves a URL-matching prefetch without touching the network, single-use', async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('network should not be hit')));
    vi.stubGlobal('fetch', fetchSpy);
    w.__vxBoot = {
      url: 'https://vinax-saavan-api.onrender.com/api/search/songs?query=top%20hindi%20songs%202099&limit=20',
      json: Promise.resolve({ marker: 'prefetched' }),
    };
    const out = await orchestratedRequest<{ marker: string }>({
      paths: ['/search/songs?query=top%20hindi%20songs%202099&limit=20'],
      validate: (j) => (j && (j as { marker?: string }).marker === 'prefetched' ? (j as { marker: string }) : null),
    });
    expect(out.marker).toBe('prefetched');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(w.__vxBoot).toBeNull(); // consumed — a reload can't replay stale data
  });

  it('falls through to the network when the prefetch URL does not match', async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ marker: 'network' }), { headers: { 'content-type': 'application/json' } })),
    );
    vi.stubGlobal('fetch', fetchSpy);
    w.__vxBoot = { url: 'https://vinax-saavan-api.onrender.com/api/other', json: Promise.resolve({ marker: 'prefetched' }) };
    const out = await orchestratedRequest<{ marker: string }>({
      paths: ['/search/songs?query=x&limit=20'],
      validate: (j) => (j && typeof (j as { marker?: string }).marker === 'string' ? (j as { marker: string }) : null),
    });
    expect(out.marker).toBe('network');
    expect(fetchSpy).toHaveBeenCalled();
  });

  it('falls through to the network when the prefetch resolved null (upstream failed)', async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ marker: 'network' }), { headers: { 'content-type': 'application/json' } })),
    );
    vi.stubGlobal('fetch', fetchSpy);
    w.__vxBoot = {
      url: 'https://vinax-saavan-api.onrender.com/api/search/songs?query=x&limit=20',
      json: Promise.resolve(null),
    };
    const out = await orchestratedRequest<{ marker: string }>({
      paths: ['/search/songs?query=x&limit=20'],
      validate: (j) => (j && typeof (j as { marker?: string }).marker === 'string' ? (j as { marker: string }) : null),
    });
    expect(out.marker).toBe('network');
    expect(fetchSpy).toHaveBeenCalled();
  });
});
