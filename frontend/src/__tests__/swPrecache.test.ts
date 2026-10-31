/**
 * 7.2.0 — the precache manifest is split: the service worker downloads the
 * `precache` list for every listener, while `onDemand` assets (chunks the
 * entry does not reach) are fetched on first use and must not be pruned
 * afterwards. A plain array (a build before 7.2) is still read.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// vite.config.ts belongs to the node TypeScript project; load it at run time so
// the app project never type-resolves it (TS6305).
type Split = (bundle: Record<string, unknown>) => { precache: string[]; onDemand: string[] };
const loadSplit = async (): Promise<Split> => {
  const spec = '../../vite.config';
  return ((await import(/* @vite-ignore */ spec)) as { splitPrecache: Split }).splitPrecache;
};

const ORIGIN = 'https://app.test';
const source = readFileSync(resolve(__dirname, '../../public/sw.js'), 'utf8');

interface Res { ok: boolean; headers: Headers; body: string }
const res = (body: string, type = 'application/javascript'): Res => ({ ok: true, headers: new Headers({ 'content-type': type }), body });

async function runPrecache(manifest: unknown, alreadyCached: string[]): Promise<{ cached: Set<string>; fetched: string[] }> {
  const store = new Map<string, Res>(alreadyCached.map((p) => [p, res('old')]));
  const fetched: string[] = [];
  const cache = {
    put: (key: string | { url: string }, r: Res) => { store.set(typeof key === 'string' ? key : new URL(key.url).pathname, r); return Promise.resolve(); },
    match: (key: string) => Promise.resolve(store.get(key)),
    keys: () => Promise.resolve([...store.keys()].map((p) => ({ url: ORIGIN + p }))),
    delete: (req: { url: string }) => { store.delete(new URL(req.url).pathname); return Promise.resolve(true); },
  };
  const listeners = new Map<string, (e: unknown) => void>();
  const fakeSelf = { location: { origin: ORIGIN }, addEventListener: (t: string, fn: (e: unknown) => void) => listeners.set(t, fn), skipWaiting: () => undefined };
  const fakeCaches = { open: () => Promise.resolve(cache), match: (k: string) => Promise.resolve(store.get(k)), keys: () => Promise.resolve([]), delete: () => Promise.resolve(true) };
  const fakeFetch = (url: string): Promise<Res> => {
    fetched.push(url);
    if (url === '/precache-manifest.json') return Promise.resolve({ ...res(''), json: () => Promise.resolve(manifest) } as unknown as Res);
    return Promise.resolve(url.startsWith('/assets/') ? res('new') : res('<html>', 'text/html'));
  };
  new Function('self', 'caches', 'fetch', source)(fakeSelf, fakeCaches, fakeFetch);
  let job: Promise<unknown> = Promise.resolve();
  listeners.get('message')?.({ data: { type: 'PRECACHE' }, waitUntil: (p: Promise<unknown>) => { job = p; } });
  await job;
  return { cached: new Set(store.keys()), fetched };
}

describe('service worker precache', () => {
  it('downloads only the precache list and keeps on-demand assets it already holds', async () => {
    const { cached, fetched } = await runPrecache({ v: 2, precache: ['/assets/app.js'], onDemand: ['/assets/diagram.js'] }, ['/assets/diagram.js', '/assets/stale-old-deploy.js']);
    expect(fetched).toContain('/assets/app.js');
    expect(fetched).not.toContain('/assets/diagram.js');
    expect(cached.has('/assets/app.js')).toBe(true);
    expect(cached.has('/assets/diagram.js')).toBe(true); // runtime-cached earlier: not pruned
    expect(cached.has('/assets/stale-old-deploy.js')).toBe(false); // left the build: pruned
  });

  it('still reads a plain array manifest', async () => {
    const { cached } = await runPrecache(['/assets/a.js'], []);
    expect(cached.has('/assets/a.js')).toBe(true);
  });
});

describe('splitPrecache', () => {
  it('precaches every chunk the app reaches and every asset; only an unreachable chunk is on demand', async () => {
    const splitPrecache = await loadSplit();
    const chunk = (fileName: string, over: Record<string, unknown> = {}) => ({ type: 'chunk' as const, fileName, imports: [], dynamicImports: [], facadeModuleId: null, isEntry: false, ...over });
    const bundle = {
      'assets/index.js': chunk('assets/index.js', { isEntry: true, dynamicImports: ['assets/Radio.js', 'assets/Home.js'] }),
      'assets/Home.js': chunk('assets/Home.js', { imports: ['assets/shared.js'] }),
      'assets/shared.js': chunk('assets/shared.js'),
      'assets/Radio.js': chunk('assets/Radio.js'),
      'assets/orphan.js': chunk('assets/orphan.js'),
      'assets/index.css': { type: 'asset' as const, fileName: 'assets/index.css' },
      'index.html': { type: 'asset' as const, fileName: 'index.html' },
    };
    const { precache, onDemand } = splitPrecache(bundle);
    expect(precache.sort()).toEqual(['/assets/Home.js', '/assets/Radio.js', '/assets/index.css', '/assets/index.js', '/assets/shared.js']);
    expect(onDemand).toEqual(['/assets/orphan.js']);
  });

  it('keeps the VinaX AI page and what only it reaches on demand', async () => {
    const splitPrecache = await loadSplit();
    const chunk = (fileName: string, over: Record<string, unknown> = {}) => ({ type: 'chunk' as const, fileName, imports: [], dynamicImports: [], facadeModuleId: null, isEntry: false, ...over });
    const bundle = {
      'assets/index.js': chunk('assets/index.js', { isEntry: true, imports: ['assets/shared.js'], dynamicImports: ['assets/VinaXAIPage.js', 'assets/Home.js'] }),
      'assets/Home.js': chunk('assets/Home.js', { facadeModuleId: '/repo/frontend/src/pages/HomePage.tsx' }),
      'assets/VinaXAIPage.js': chunk('assets/VinaXAIPage.js', { facadeModuleId: '/repo/frontend/src/pages/VinaXAIPage.tsx', imports: ['assets/shared.js'], dynamicImports: ['assets/highlight.js'] }),
      'assets/highlight.js': chunk('assets/highlight.js'),
      'assets/shared.js': chunk('assets/shared.js'),
    };
    const { precache, onDemand } = splitPrecache(bundle);
    expect(onDemand.sort()).toEqual(['/assets/VinaXAIPage.js', '/assets/highlight.js']);
    expect(precache).toContain('/assets/shared.js'); // still reached by the app itself
  });

  it('keeps the on-demand page stylesheets and the maths fonts out of the precache', async () => {
    const splitPrecache = await loadSplit();
    const chunk = (fileName: string, over: Record<string, unknown> = {}) => ({ type: 'chunk' as const, fileName, imports: [], dynamicImports: [], facadeModuleId: null, isEntry: false, ...over });
    const asset = (fileName: string) => ({ type: 'asset' as const, fileName });
    const bundle = {
      'assets/index-a1.js': chunk('assets/index-a1.js', { isEntry: true, dynamicImports: ['assets/VinaXAIPage-b2.js'], viteMetadata: { importedCss: new Set(['assets/index-a1.css']) } }),
      'assets/VinaXAIPage-b2.js': chunk('assets/VinaXAIPage-b2.js', { facadeModuleId: '/r/src/pages/VinaXAIPage.tsx', dynamicImports: ['assets/math-c3.js'], viteMetadata: { importedCss: new Set(['assets/VinaXAIPage-b9.css']) } }),
      'assets/math-c3.js': chunk('assets/math-c3.js'),
      'assets/index-a1.css': asset('assets/index-a1.css'),
      'assets/VinaXAIPage-b9.css': asset('assets/VinaXAIPage-b9.css'),
      'assets/math-c7.css': asset('assets/math-c7.css'),
      'assets/KaTeX_Main-Regular-d4.woff2': asset('assets/KaTeX_Main-Regular-d4.woff2'),
      'assets/pdf.worker.min-f6.mjs': asset('assets/pdf.worker.min-f6.mjs'),
      'assets/micTap.worklet-g8.js': asset('assets/micTap.worklet-g8.js'),
      'assets/inter-e5.woff2': asset('assets/inter-e5.woff2'),
    };
    const { precache, onDemand } = splitPrecache(bundle);
    expect(onDemand.sort()).toEqual(['/assets/KaTeX_Main-Regular-d4.woff2', '/assets/VinaXAIPage-b2.js', '/assets/VinaXAIPage-b9.css', '/assets/math-c3.js', '/assets/math-c7.css', '/assets/micTap.worklet-g8.js', '/assets/pdf.worker.min-f6.mjs']);
    expect(precache.sort()).toEqual(['/assets/index-a1.css', '/assets/index-a1.js', '/assets/inter-e5.woff2']);
  });
});
