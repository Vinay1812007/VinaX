/**
 * public/sw.js is a classic worker script, not a module — it is evaluated
 * here against fakes so the navigation handler's shell-caching rule is
 * pinned: only the SPA's own, un-redirected HTML may be stored as '/'.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

const ORIGIN = 'https://app.test';
const source = readFileSync(resolve(__dirname, '../../public/sw.js'), 'utf8');

interface FakeResponse {
  ok: boolean;
  redirected: boolean;
  body: string;
  headers: Headers;
  clone(): FakeResponse;
}
interface FakeRequest {
  method: string;
  mode: string;
  url: string;
  headers: Headers;
}
interface FetchEvent {
  request: FakeRequest;
  respondWith(p: Promise<FakeResponse>): void;
}
type Listener = (event: FetchEvent) => void;

function response(body: string, init: Partial<Pick<FakeResponse, 'ok' | 'redirected'>> & { type?: string } = {}): FakeResponse {
  const res: FakeResponse = {
    ok: init.ok ?? true,
    redirected: init.redirected ?? false,
    body,
    headers: new Headers({ 'content-type': init.type ?? 'text/html; charset=utf-8' }),
    clone: () => ({ ...res }),
  };
  return res;
}

/** Evaluate the worker with fake globals; returns its fetch listener + the shell cache. */
function boot(network: (url: string) => Promise<FakeResponse>): { onFetch: Listener; shell: Map<string, FakeResponse> } {
  const listeners = new Map<string, Listener>();
  const shell = new Map<string, FakeResponse>();
  const cache = {
    put: (key: string, res: FakeResponse) => {
      shell.set(key, res);
      return Promise.resolve();
    },
    match: (key: string) => Promise.resolve(shell.get(key)),
  };
  const fakeSelf = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: Listener) => listeners.set(type, fn),
  };
  const fakeCaches = {
    open: () => Promise.resolve(cache),
    match: (key: string) => Promise.resolve(shell.get(key)),
  };
  const fakeFetch = (req: FakeRequest | string): Promise<FakeResponse> => network(typeof req === 'string' ? req : req.url);
  new Function('self', 'caches', 'fetch', source)(fakeSelf, fakeCaches, fakeFetch);
  const onFetch = listeners.get('fetch');
  if (!onFetch) throw new Error('sw.js registered no fetch listener');
  return { onFetch, shell };
}

async function navigate(onFetch: Listener, path: string): Promise<FakeResponse> {
  let answer: Promise<FakeResponse> | null = null;
  onFetch({
    request: { method: 'GET', mode: 'navigate', url: ORIGIN + path, headers: new Headers() },
    respondWith: (p) => {
      answer = p;
    },
  });
  if (!answer) throw new Error(`navigation to ${path} was not handled`);
  const res = await (answer as Promise<FakeResponse>);
  await new Promise((r) => setTimeout(r, 0)); // let the best-effort cache write land
  return res;
}

describe('sw.js navigation shell caching', () => {
  let pages: Record<string, FakeResponse>;
  let worker: ReturnType<typeof boot>;

  beforeEach(() => {
    pages = {};
    worker = boot((url) => {
      const hit = pages[new URL(url).pathname];
      return hit ? Promise.resolve(hit) : Promise.reject(new TypeError('offline'));
    });
  });

  it('stores SPA navigations as the offline shell', async () => {
    pages['/'] = response('app');
    pages['/search'] = response('app-deep');
    await navigate(worker.onFetch, '/');
    expect(worker.shell.get('/')?.body).toBe('app');
    await navigate(worker.onFetch, '/search');
    expect(worker.shell.get('/')?.body).toBe('app-deep');
  });

  it.each(['/admin/', '/admin', '/status/', '/status/index.html', '/api/version'])(
    'never stores %s as the shell',
    async (path) => {
      pages['/'] = response('app');
      pages[path] = response('other-page');
      await navigate(worker.onFetch, '/');
      const res = await navigate(worker.onFetch, path);
      expect(res.body).toBe('other-page'); // still served from the network
      expect(worker.shell.get('/')?.body).toBe('app');
    },
  );

  it('does not mistake look-alike SPA routes for the excluded pages', async () => {
    pages['/administrator'] = response('app-route');
    await navigate(worker.onFetch, '/administrator');
    expect(worker.shell.get('/')?.body).toBe('app-route');
  });

  it('never stores a redirected response', async () => {
    pages['/'] = response('app');
    pages['/old'] = response('elsewhere', { redirected: true });
    await navigate(worker.onFetch, '/');
    await navigate(worker.onFetch, '/old');
    expect(worker.shell.get('/')?.body).toBe('app');
  });

  it('never stores errors or non-HTML bodies', async () => {
    pages['/boom'] = response('nope', { ok: false });
    pages['/feed'] = response('{}', { type: 'application/json' });
    await navigate(worker.onFetch, '/boom');
    await navigate(worker.onFetch, '/feed');
    expect(worker.shell.has('/')).toBe(false);
  });

  it('falls back to the cached shell when the network fails', async () => {
    pages['/'] = response('app');
    await navigate(worker.onFetch, '/');
    delete pages['/'];
    const res = await navigate(worker.onFetch, '/library');
    expect(res.body).toBe('app');
  });
});

describe('sw.js and VinaX AI', () => {
  it('serves /vinaxai and a chat address the app shell, also offline', async () => {
    const pages: Record<string, FakeResponse> = { '/vinaxai': response('app-chat') };
    const worker = boot((url) => {
      const hit = pages[new URL(url).pathname];
      return hit ? Promise.resolve(hit) : Promise.reject(new TypeError('offline'));
    });
    await navigate(worker.onFetch, '/vinaxai');
    expect(worker.shell.get('/')?.body).toBe('app-chat');
    const res = await navigate(worker.onFetch, '/vinaxai/c/0b6c2f6e-1c1e-4b51-9a57-3d1f3e2a9b10');
    expect(res.body).toBe('app-chat');
  });

  it('never answers or caches /api/ai/* (the chat stream is a POST; the rest are API reads)', () => {
    const worker = boot(() => Promise.reject(new TypeError('should not be called')));
    for (const [method, path] of [['POST', '/api/ai/chat'], ['GET', '/api/ai/models'], ['GET', '/api/ai/conversations']]) {
      let handled = false;
      worker.onFetch({
        request: { method, mode: 'cors', url: ORIGIN + path, headers: new Headers() },
        respondWith: () => { handled = true; },
      });
      expect(handled, `${method} ${path}`).toBe(false);
    }
  });
});
