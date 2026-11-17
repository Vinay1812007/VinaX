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
type Split = (bundle: Record<string, unknown>) => { precache: string[]; onDemand: string[]; light: string[] };
const loadSplit = async (): Promise<Split> => {
  const spec = '../../vite.config';
  return ((await import(/* @vite-ignore */ spec)) as { splitPrecache: Split }).splitPrecache;
};

const ORIGIN = 'https://app.test';
const source = readFileSync(resolve(__dirname, '../../public/sw.js'), 'utf8');

interface Res { ok: boolean; headers: Headers; body: string }
const res = (body: string, type = 'application/javascript'): Res => ({ ok: true, headers: new Headers({ 'content-type': type }), body });

async function runPrecache(manifest: unknown, alreadyCached: string[], message: Record<string, unknown> | 'install' = { type: 'PRECACHE' }): Promise<{ cached: Set<string>; fetched: string[] }> {
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
  const waitUntil = (p: Promise<unknown>) => { job = p; };
  if (message === 'install') listeners.get('install')?.({ waitUntil });
  else listeners.get('message')?.({ data: message, waitUntil });
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

  it('the light mode downloads only the light list and prunes as the full one does', async () => {
    const manifest = { v: 2, precache: ['/assets/index.js', '/assets/Library.js', '/assets/Radio.js'], onDemand: ['/assets/ai.js'], light: ['/assets/index.js', '/assets/Library.js'] };
    const { cached, fetched } = await runPrecache(manifest, ['/assets/Radio.js', '/assets/ai.js', '/assets/old.js'], { type: 'PRECACHE', mode: 'light' });
    expect(fetched).toContain('/assets/index.js');
    expect(fetched).toContain('/assets/Library.js');
    expect(fetched).not.toContain('/assets/Radio.js');
    expect(cached.has('/assets/Radio.js')).toBe(true); // in the build: kept
    expect(cached.has('/assets/ai.js')).toBe(true);
    expect(cached.has('/assets/old.js')).toBe(false);
  });

  it('install takes the light precache; the page asks for the rest', async () => {
    const { fetched } = await runPrecache({ v: 2, precache: ['/assets/index.js', '/assets/Radio.js'], onDemand: [], light: ['/assets/index.js'] }, [], 'install');
    expect(fetched).toContain('/assets/index.js');
    expect(fetched).not.toContain('/assets/Radio.js');
  });

  it('a light request on a manifest without a light list gets the full one', async () => {
    const { fetched } = await runPrecache({ v: 2, precache: ['/assets/a.js', '/assets/b.js'], onDemand: [] }, [], { type: 'PRECACHE', mode: 'light' });
    expect(fetched).toEqual(expect.arrayContaining(['/assets/a.js', '/assets/b.js']));
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

  it('keeps a shared chat\'s page and the artifacts gallery on demand too, with the chat code only they and the chat reach', async () => {
    const splitPrecache = await loadSplit();
    const chunk = (fileName: string, over: Record<string, unknown> = {}) => ({ type: 'chunk' as const, fileName, imports: [], dynamicImports: [], facadeModuleId: null, isEntry: false, ...over });
    const bundle = {
      'assets/index.js': chunk('assets/index.js', { isEntry: true, dynamicImports: ['assets/VinaXAIPage.js', 'assets/VinaXAISharePage.js', 'assets/VinaXAIArtifactsPage.js'] }),
      'assets/VinaXAIPage.js': chunk('assets/VinaXAIPage.js', { facadeModuleId: '/r/src/pages/VinaXAIPage.tsx', imports: ['assets/Markdown.js'] }),
      'assets/VinaXAISharePage.js': chunk('assets/VinaXAISharePage.js', { facadeModuleId: '/r/src/pages/VinaXAISharePage.tsx', imports: ['assets/Markdown.js'] }),
      'assets/VinaXAIArtifactsPage.js': chunk('assets/VinaXAIArtifactsPage.js', { facadeModuleId: '/r/src/pages/VinaXAIArtifactsPage.tsx', imports: ['assets/Markdown.js'] }),
      'assets/Markdown.js': chunk('assets/Markdown.js'),
    };
    const { precache, onDemand } = splitPrecache(bundle);
    expect(onDemand.sort()).toEqual(['/assets/Markdown.js', '/assets/VinaXAIArtifactsPage.js', '/assets/VinaXAIPage.js', '/assets/VinaXAISharePage.js']);
    expect(precache).toEqual(['/assets/index.js']);
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

  it('lists a light precache: the entry graph and the layout\'s lazy pieces, stopping at route pages other than Offline, Library and Now Playing', async () => {
    const splitPrecache = await loadSplit();
    const chunk = (fileName: string, over: Record<string, unknown> = {}) => ({ type: 'chunk' as const, fileName, imports: [], dynamicImports: [], facadeModuleId: null, isEntry: false, ...over });
    const asset = (fileName: string) => ({ type: 'asset' as const, fileName });
    const bundle = {
      'assets/index.js': chunk('assets/index.js', { isEntry: true, imports: ['assets/vendor.js'], dynamicImports: ['assets/Offline.js', 'assets/Library.js', 'assets/NowPlaying.js', 'assets/Radio.js', 'assets/VinaXAIPage.js', 'assets/Bridges.js'], viteMetadata: { importedCss: new Set(['assets/index.css']) } }),
      'assets/vendor.js': chunk('assets/vendor.js'),
      'assets/Offline.js': chunk('assets/Offline.js', { facadeModuleId: '/r/src/pages/OfflinePage.tsx', imports: ['assets/rows.js'] }),
      'assets/Library.js': chunk('assets/Library.js', { facadeModuleId: '/r/src/pages/LibraryPage.tsx', imports: ['assets/rows.js'], dynamicImports: ['assets/ImportSheet.js'], viteMetadata: { importedCss: new Set(['assets/Library.css']) } }),
      'assets/rows.js': chunk('assets/rows.js'),
      'assets/NowPlaying.js': chunk('assets/NowPlaying.js', { facadeModuleId: '/r/src/pages/NowPlayingPage.tsx' }),
      'assets/Bridges.js': chunk('assets/Bridges.js', { facadeModuleId: '/r/src/layouts/Bridges15.tsx', dynamicImports: ['assets/Search.js'] }),
      'assets/Search.js': chunk('assets/Search.js', { facadeModuleId: '/r/src/pages/SearchPage.tsx', imports: ['assets/searchLib.js'] }),
      'assets/searchLib.js': chunk('assets/searchLib.js'),
      'assets/ImportSheet.js': chunk('assets/ImportSheet.js'),
      'assets/Radio.js': chunk('assets/Radio.js', { facadeModuleId: '/r/src/pages/RadioPage.tsx', viteMetadata: { importedCss: new Set(['assets/Radio.css']) } }),
      'assets/VinaXAIPage.js': chunk('assets/VinaXAIPage.js', { facadeModuleId: '/r/src/pages/VinaXAIPage.tsx' }),
      'assets/index.css': asset('assets/index.css'),
      'assets/Library.css': asset('assets/Library.css'),
      'assets/Radio.css': asset('assets/Radio.css'),
    };
    const { precache, light } = splitPrecache(bundle);
    expect(light.sort()).toEqual(['/assets/Bridges.js', '/assets/ImportSheet.js', '/assets/Library.css', '/assets/Library.js', '/assets/NowPlaying.js', '/assets/Offline.js', '/assets/index.css', '/assets/index.js', '/assets/rows.js', '/assets/vendor.js']);
    for (const f of light) expect(precache).toContain(f);
    for (const f of ['/assets/Radio.js', '/assets/Radio.css', '/assets/Search.js', '/assets/searchLib.js']) expect(precache).toContain(f);
    expect(light).not.toContain('/assets/VinaXAIPage.js');
  });
});
