/**
 * 7.2.0 — the precache manifest is split: the service worker downloads the
 * `precache` list for every listener, while `onDemand` assets (the diagram and
 * maths engines behind VinaX AI replies) are fetched on first use and must not
 * be pruned afterwards. A plain array (a build before 7.2) is still read.
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
  it('keeps everything the app reaches and puts only the diagram and maths engines (and what only they reach) on demand', async () => {
    const splitPrecache = await loadSplit();
    const chunk = (fileName: string, over: Record<string, unknown> = {}) => ({ type: 'chunk' as const, fileName, imports: [], dynamicImports: [], facadeModuleId: null, isEntry: false, ...over });
    const bundle = {
      'assets/index.js': chunk('assets/index.js', { isEntry: true, dynamicImports: ['assets/AiPage.js', 'assets/Home.js'] }),
      'assets/Home.js': chunk('assets/Home.js', { imports: ['assets/shared.js'] }),
      'assets/shared.js': chunk('assets/shared.js'),
      'assets/AiPage.js': chunk('assets/AiPage.js', { dynamicImports: ['assets/mermaid.js', 'assets/katex.js'] }),
      'assets/mermaid.js': chunk('assets/mermaid.js', { facadeModuleId: '/app/node_modules/mermaid/dist/mermaid.core.mjs', imports: ['assets/cytoscape.js', 'assets/shared.js'] }),
      'assets/cytoscape.js': chunk('assets/cytoscape.js'),
      'assets/katex.js': chunk('assets/katex.js', { facadeModuleId: '/app/node_modules/katex/dist/katex.mjs' }),
      'assets/KaTeX_Main-Regular.woff2': { type: 'asset' as const, fileName: 'assets/KaTeX_Main-Regular.woff2' },
      'assets/katex-abc.css': { type: 'asset' as const, fileName: 'assets/katex-abc.css' },
      'assets/index.css': { type: 'asset' as const, fileName: 'assets/index.css' },
      'index.html': { type: 'asset' as const, fileName: 'index.html' },
    };
    const { precache, onDemand } = splitPrecache(bundle);
    expect(precache.sort()).toEqual(['/assets/AiPage.js', '/assets/Home.js', '/assets/index.css', '/assets/index.js', '/assets/shared.js']);
    expect(onDemand.sort()).toEqual(['/assets/KaTeX_Main-Regular.woff2', '/assets/cytoscape.js', '/assets/katex-abc.css', '/assets/katex.js', '/assets/mermaid.js']);
  });
});
