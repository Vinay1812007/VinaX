import { describe, expect, it, vi } from 'vitest';
import { API_ORIGIN, FALLBACK_MS, apiUrlFor, hostDown, installApiHost } from './apiHost';

const SITE = 'https://www.vinaxmusic.online';

describe('apiUrlFor', () => {
  it('sends relative and absolute site /api/* calls to the API host', () => {
    expect(apiUrlFor('/api/status', `${SITE}/library`)).toBe(`${API_ORIGIN}/api/status`);
    expect(apiUrlFor('/api/cat/search/songs?query=a b&limit=2', `${SITE}/`)).toBe(`${API_ORIGIN}/api/cat/search/songs?query=a%20b&limit=2`);
    expect(apiUrlFor(`${SITE}/api/experiments`, `${SITE}/`)).toBe(`${API_ORIGIN}/api/experiments`);
    expect(apiUrlFor('https://vinaxmusic.online/api/geo', `${SITE}/`)).toBe(`${API_ORIGIN}/api/geo`);
  });

  it('leaves everything else alone', () => {
    expect(apiUrlFor('/manifest.webmanifest', `${SITE}/`)).toBeNull();
    expect(apiUrlFor('/img?url=x', `${SITE}/`)).toBeNull();
    expect(apiUrlFor('/apish', `${SITE}/`)).toBeNull();
    expect(apiUrlFor('https://lrclib.net/api/get', `${SITE}/`)).toBeNull();
    expect(apiUrlFor(`${API_ORIGIN}/api/status`, `${SITE}/`)).toBeNull();
    expect(apiUrlFor('/api/apk', `${SITE}/`)).toBeNull();
    expect(apiUrlFor('/api/push/unsubscribe', `${SITE}/`)).toBeNull();
    expect(apiUrlFor('http://[bad', `${SITE}/`)).toBeNull();
  });
});

describe('hostDown', () => {
  it("is Cloudflare's own error page, never an API answer", () => {
    expect(hostDown(new Response('<html>', { status: 530, headers: { 'content-type': 'text/html' } }))).toBe(true);
    expect(hostDown(new Response('bad gateway', { status: 502 }))).toBe(true);
    expect(hostDown(new Response('{"error":"unavailable"}', { status: 503, headers: { 'content-type': 'application/json' } }))).toBe(false);
    expect(hostDown(new Response('{}', { status: 500, headers: { 'content-type': 'text/html' } }))).toBe(false);
    expect(hostDown(new Response('ok'))).toBe(false);
  });
});

function fakeWindow(origin: string, impl: (url: string, init?: RequestInit) => Promise<Response>) {
  const calls: string[] = [];
  const beacons: string[] = [];
  const win = {
    location: { origin, href: `${origin}/home` },
    fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      calls.push(url);
      return impl(url, init);
    }) as unknown as typeof fetch,
    navigator: {
      sendBeacon: (url: string | URL, _data?: BodyInit | null) => {
        beacons.push(String(url));
        return true;
      },
    },
  };
  return { win, calls, beacons };
}

describe('installApiHost', () => {
  it('does nothing off the real site', () => {
    const { win } = fakeWindow('http://localhost:4173', async () => new Response('ok'));
    const before = win.fetch;
    expect(installApiHost(win)).toBe(false);
    expect(win.fetch).toBe(before);
  });

  it('rewrites /api/* and passes other calls through', async () => {
    const { win, calls } = fakeWindow(SITE, async () => new Response('ok'));
    expect(installApiHost(win)).toBe(true);
    await win.fetch('/api/status');
    await win.fetch('/sw.js');
    await win.fetch(new URL(`${SITE}/api/geo`));
    expect(calls).toEqual([`${API_ORIGIN}/api/status`, '/sw.js', `${API_ORIGIN}/api/geo`]);
  });

  it('keeps method, headers and body', async () => {
    let seen: RequestInit | undefined;
    const { win } = fakeWindow(SITE, async (_u, init) => {
      seen = init;
      return new Response('ok');
    });
    installApiHost(win);
    await win.fetch('/api/feedback', { method: 'POST', headers: { authorization: 'Bearer t' }, body: '{"a":1}' });
    expect(seen?.method).toBe('POST');
    expect((seen?.headers as Record<string, string>).authorization).toBe('Bearer t');
    expect(seen?.body).toBe('{"a":1}');
  });

  it('falls back to the site when the API host is unreachable, then stays there for a minute', async () => {
    let t = 1_000;
    const { win, calls } = fakeWindow(SITE, async (url) => {
      if (url.startsWith(API_ORIGIN)) throw new TypeError('Failed to fetch');
      return new Response('from worker');
    });
    installApiHost(win, () => t);
    expect(await (await win.fetch('/api/status')).text()).toBe('from worker');
    expect(calls).toEqual([`${API_ORIGIN}/api/status`, '/api/status']);
    calls.length = 0;
    await win.fetch('/api/geo');
    expect(calls).toEqual(['/api/geo']);
    calls.length = 0;
    t += FALLBACK_MS + 1;
    await win.fetch('/api/geo');
    expect(calls[0]).toBe(`${API_ORIGIN}/api/geo`);
  });

  it("falls back on Cloudflare's origin-down page but not on an API error", async () => {
    const { win, calls } = fakeWindow(SITE, async (url) => {
      if (url.endsWith('/down')) return url.startsWith(API_ORIGIN) ? new Response('<html>', { status: 530, headers: { 'content-type': 'text/html' } }) : new Response('worker');
      return new Response('{"error":"unavailable"}', { status: 503, headers: { 'content-type': 'application/json' } });
    });
    installApiHost(win);
    const api = await win.fetch('/api/ai/chat');
    expect(api.status).toBe(503);
    expect(calls).toEqual([`${API_ORIGIN}/api/ai/chat`]);
    calls.length = 0;
    expect(await (await win.fetch('/api/down')).text()).toBe('worker');
    expect(calls).toEqual([`${API_ORIGIN}/api/down`, '/api/down']);
  });

  it('does not retry an aborted call', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const { win, calls } = fakeWindow(SITE, async () => {
      throw new DOMException('aborted', 'AbortError');
    });
    installApiHost(win);
    await expect(win.fetch('/api/status', { signal: ctrl.signal })).rejects.toThrow();
    expect(calls).toEqual([`${API_ORIGIN}/api/status`]);
  });

  it('sends beacons to the API host too', () => {
    const { win, beacons } = fakeWindow(SITE, async () => new Response('ok'));
    installApiHost(win);
    win.navigator.sendBeacon('/api/room', '{}');
    win.navigator.sendBeacon('/other', '{}');
    expect(beacons).toEqual([`${API_ORIGIN}/api/room`, '/other']);
  });
});
