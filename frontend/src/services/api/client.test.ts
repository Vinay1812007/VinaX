// @vitest-environment jsdom
/**
 * Pins the boot-prefetch contract (4.18.2): index.html parks the cold-load
 * trending request on window.__vxBoot; the orchestrator consumes it by exact
 * URL match, exactly once, and falls back to the network on any miss or a
 * null payload (upstream failure). See index.html + takeBootPrefetch().
 * v5.6.7: URLs track the FIRST ranked base — now the VinaX Music API.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, fetchWithTimeout, orchestratedRequest, REQUEST_DEADLINE_MS } from './client';

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

describe('overall deadline + abortable backoff', () => {
  /** A base that never answers: the fetch only settles when it is aborted. */
  const hang = () =>
    vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );

  const run = (req: Parameters<typeof orchestratedRequest<string>>[0]) => {
    const settled = { done: false, error: null as unknown, at: 0 };
    const started = performance.now();
    void orchestratedRequest<string>(req)
      .catch((err: unknown) => {
        settled.error = err;
      })
      .finally(() => {
        settled.done = true;
        settled.at = performance.now() - started;
      });
    return settled;
  };

  afterEach(() => vi.useRealTimers());

  it('gives up at the deadline instead of walking every base twice', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
    const fetchSpy = hang();
    vi.stubGlobal('fetch', fetchSpy);
    const settled = run({ paths: ['/a', '/b'], validate: () => null, deadlineMs: 10_000 });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(settled.done).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(settled.done).toBe(true);
    expect(settled.error).toBeInstanceOf(ApiError);
    expect(settled.at).toBeLessThanOrEqual(10_001);
    // 8 s per attempt: one full attempt, then one clipped to the remaining 2 s.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('defaults to a ~20 s budget', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
    vi.stubGlobal('fetch', hang());
    const settled = run({ paths: ['/a'], validate: () => null });
    await vi.advanceTimersByTimeAsync(REQUEST_DEADLINE_MS - 1);
    expect(settled.done).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(settled.done).toBe(true);
    expect(REQUEST_DEADLINE_MS).toBeLessThanOrEqual(20_000);
  });

  it('a cancel during the retry backoff ends the request at once', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
    const fetchSpy = vi.fn(() => Promise.reject(new TypeError('network down')));
    vi.stubGlobal('fetch', fetchSpy);
    const controller = new AbortController();
    const settled = run({ paths: ['/a'], validate: () => null, signal: controller.signal });
    await vi.advanceTimersByTimeAsync(0); // pass 1 fails instantly on every base → backoff
    const afterFirstPass = fetchSpy.mock.calls.length;
    expect(afterFirstPass).toBeGreaterThan(0);
    expect(settled.done).toBe(false);
    controller.abort();
    await vi.advanceTimersByTimeAsync(0); // no need to sit out the 600 ms
    expect(settled.done).toBe(true);
    expect((settled.error as ApiError).message).toBe('cancelled');
    expect(fetchSpy.mock.calls.length).toBe(afterFirstPass);
  });
});

describe('fetchWithTimeout', () => {
  afterEach(() => vi.useRealTimers());

  const hang = () =>
    vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );

  it('aborts a hung request at the timeout', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.stubGlobal('fetch', hang());
    const outcome = fetchWithTimeout('/api/trending-searches', 6000).then(
      () => 'resolved',
      (err: Error) => err.name,
    );
    await vi.advanceTimersByTimeAsync(6000);
    expect(await outcome).toBe('AbortError');
  });

  it('aborts at once when the caller cancels, and passes a response through', async () => {
    vi.stubGlobal('fetch', hang());
    const controller = new AbortController();
    const outcome = fetchWithTimeout('/x', 60_000, controller.signal).then(
      () => 'resolved',
      (err: Error) => err.name,
    );
    controller.abort();
    expect(await outcome).toBe('AbortError');

    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{"queries":["a"]}'))));
    const res = await fetchWithTimeout('/x', 1000);
    expect(await res.json()).toEqual({ queries: ['a'] });
  });
});
