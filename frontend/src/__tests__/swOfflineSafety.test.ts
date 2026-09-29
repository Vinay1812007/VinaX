/**
 * Downloaded songs live in the `vinax-audio-v1` Cache API bucket. Two pieces
 * of code delete caches wholesale and must never take that bucket with them:
 * the service worker's activate prune (public/sw.js) and the boot recovery
 * in index.html. The recovery must also leave everything alone when the
 * device is offline — purging there cannot fetch a fresh app, it only
 * destroys the offline copy (the 8.2.0 "offline launch shows an error page"
 * report). Both scripts are evaluated here against fakes.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const AUDIO = 'vinax-audio-v1';

describe('sw.js activate', () => {
  it('prunes old shell caches but never the downloaded-songs bucket', async () => {
    const source = readFileSync(resolve(__dirname, '../../public/sw.js'), 'utf8');
    const listeners = new Map<string, (e: { waitUntil(p: Promise<unknown>): void }) => void>();
    const deleted: string[] = [];
    const fakeSelf = {
      location: { origin: 'https://app.test' },
      addEventListener: (type: string, fn: (e: { waitUntil(p: Promise<unknown>): void }) => void) => listeners.set(type, fn),
      clients: { claim: () => Promise.resolve() },
    };
    const fakeCaches = {
      keys: () => Promise.resolve(['vinax-shell-v12', AUDIO, 'vinax-shell-v14', 'something-else']),
      delete: (k: string) => {
        deleted.push(k);
        return Promise.resolve(true);
      },
    };
    new Function('self', 'caches', 'fetch', source)(fakeSelf, fakeCaches, () => Promise.reject(new Error('offline')));
    let job: Promise<unknown> = Promise.resolve();
    listeners.get('activate')?.({ waitUntil: (p) => (job = p) });
    await job;
    expect(deleted.sort()).toEqual(['something-else', 'vinax-shell-v12']);
  });
});

/** The inline boot-recovery script from index.html. */
function bootScript(): string {
  const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');
  for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    if (m[1].includes('vinax.bootPanicked')) return m[1];
  }
  throw new Error('boot recovery script not found in index.html');
}

interface Env {
  onLine: boolean;
  /** What the origin probe answers: true = 200, false = network error. */
  reachable: boolean;
  mounted?: boolean;
}

/** Run the boot script in a fake page; returns handles to drive and inspect it. */
function boot(env: Env) {
  const listeners = new Map<string, Array<(e: unknown) => void>>();
  const timers: Array<() => void> = [];
  const session = new Map<string, string>();
  const status = { textContent: 'Music tuned to you' };
  const log = { deleted: [] as string[], unregistered: 0, replaced: 0, reloaded: 0, probes: 0 };
  const win = {
    addEventListener: (type: string, fn: (e: unknown) => void) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
  };
  const doc = {
    getElementById: (id: string) => (id === 'boot' && !env.mounted ? {} : null),
    querySelector: () => (env.mounted ? null : status),
    createElement: () => ({}),
    head: { appendChild: () => undefined },
  };
  const nav = {
    onLine: env.onLine,
    serviceWorker: {
      getRegistrations: () =>
        Promise.resolve([
          {
            unregister: () => {
              log.unregistered += 1;
              return Promise.resolve(true);
            },
          },
        ]),
    },
  };
  const fakeCaches = {
    keys: () => Promise.resolve(['vinax-shell-v14', AUDIO]),
    delete: (k: string) => {
      log.deleted.push(k);
      return Promise.resolve(true);
    },
  };
  const loc = {
    pathname: '/',
    replace: () => (log.replaced += 1),
    reload: () => (log.reloaded += 1),
  };
  const storage = {
    getItem: (k: string) => session.get(k) ?? null,
    setItem: (k: string, v: string) => session.set(k, v),
  };
  const fakeFetch = () => {
    log.probes += 1;
    return env.reachable ? Promise.resolve({ ok: true }) : Promise.reject(new TypeError('Failed to fetch'));
  };
  const fakeTimeout = (fn: () => void) => timers.push(fn);
  new Function('window', 'document', 'navigator', 'caches', 'location', 'sessionStorage', 'setTimeout', 'fetch', bootScript())(
    win,
    doc,
    nav,
    fakeCaches,
    loc,
    storage,
    fakeTimeout,
    fakeFetch,
  );
  const settle = () => new Promise((r) => setTimeout(r, 0));
  return {
    log,
    status,
    session,
    /** Fire the 15 s hang watchdog (the first timer the script arms). */
    async watchdog() {
      timers[0]();
      await settle();
      await settle();
    },
    /** A failed /assets/ entry script. */
    async scriptError() {
      for (const fn of listeners.get('error') ?? []) fn({ target: { tagName: 'SCRIPT', src: 'https://app.test/assets/index-abc.js' } });
      await settle();
      await settle();
    },
    goOnline() {
      for (const fn of listeners.get('online') ?? []) fn({});
    },
  };
}

describe('index.html boot recovery', () => {
  it('online: purges the shell caches and the worker, keeps downloaded songs', async () => {
    const page = boot({ onLine: true, reachable: true });
    await page.watchdog();
    expect(page.log.deleted).toEqual(['vinax-shell-v14']);
    expect(page.log.unregistered).toBe(1);
    expect(page.log.replaced).toBe(1);
    expect(page.session.get('vinax.bootPanicked')).toBe('1');
  });

  it('offline: touches nothing, explains, and reloads when the connection returns', async () => {
    const page = boot({ onLine: false, reachable: false });
    await page.watchdog();
    expect(page.log).toEqual({ deleted: [], unregistered: 0, replaced: 0, reloaded: 0, probes: 0 });
    expect(page.status.textContent).toMatch(/offline/i);
    expect(page.session.has('vinax.bootPanicked')).toBe(false); // a later online launch can still recover
    page.goOnline();
    expect(page.log.reloaded).toBe(1);
  });

  it('connected to a network without internet: the probe fails, so nothing is purged', async () => {
    const page = boot({ onLine: true, reachable: false });
    await page.watchdog();
    expect(page.log.probes).toBe(1);
    expect(page.log.deleted).toEqual([]);
    expect(page.log.unregistered).toBe(0);
    expect(page.log.replaced).toBe(0);
    expect(page.status.textContent).toMatch(/offline/i);
  });

  it('offline: a failed entry script waits for the connection instead of reloading', async () => {
    const page = boot({ onLine: false, reachable: false });
    await page.scriptError(); // the one-shot URL-bust heal
    await page.scriptError(); // the ladder
    expect(page.log.reloaded).toBe(0);
    expect(page.log.deleted).toEqual([]);
    expect(page.status.textContent).toMatch(/offline/i);
  });

  it('a mounted app makes the watchdog a no-op', async () => {
    const page = boot({ onLine: true, reachable: true, mounted: true });
    await page.watchdog();
    expect(page.log).toEqual({ deleted: [], unregistered: 0, replaced: 0, reloaded: 0, probes: 0 });
  });
});
