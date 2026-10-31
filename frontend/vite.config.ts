/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')) as {
  version: string;
};

const BUILD_NUMBER = process.env.VITE_BUILD_NUMBER || '';
const APP_VERSION = BUILD_NUMBER ? `${pkg.version}+${BUILD_NUMBER}` : pkg.version;

/** Emit /precache-manifest.json — the URL of every hashed build asset — so
 *  the service worker (public/sw.js) can download the complete chunk graph
 *  up front and the whole app keeps working offline. The Android shell needs
 *  this: with runtime caching alone, a lazy page the user had never visited
 *  (e.g. Downloads) was simply missing offline, so tapping "downloads" while
 *  offline hit a failed chunk import (v5.3.1 offline-downloads fix). */
/** 7.2.0 — every chunk the entry can reach is precached; a chunk nothing
 *  reaches is listed ON DEMAND (fetched and runtime-cached on first use,
 *  never pruned afterwards). The VinaX AI page (its Markdown renderer, code
 *  highlighter and maths engine) is on demand too, with its stylesheets and
 *  the maths fonts: it needs the network anyway, and a listener who never
 *  opens the chat should not download it. */
export const ON_DEMAND_PAGES = /\/src\/pages\/VinaXAIPage\.tsx$/;
/** The maths engine's fonts (loaded by its on-demand stylesheet), the PDF reader's worker (loaded when a PDF is added) and Live voice's mic tap (loaded when Live voice opens). */
export const ON_DEMAND_ASSETS = /^assets\/(KaTeX_[\w-]+\.(woff2?|ttf)|pdf\.worker[\w.-]*\.m?js|micTap\.worklet[\w.-]*\.js)$/;

type BundleItem = {
  type: 'chunk' | 'asset';
  fileName: string;
  name?: string;
  isEntry?: boolean;
  facadeModuleId?: string | null;
  imports?: string[];
  dynamicImports?: string[];
  viteMetadata?: { importedCss?: Set<string> };
};

/** Split the build's assets into what the service worker precaches and what it fetches on demand. */
export function splitPrecache(bundle: Record<string, BundleItem>): { precache: string[]; onDemand: string[] } {
  const all = Object.keys(bundle).filter((f) => f.startsWith('assets/')).sort();
  const chunks = Object.values(bundle).filter((c) => c.type === 'chunk');
  const byFile = new Map(chunks.map((c) => [c.fileName, c]));
  const reached = new Set<string>();
  const stack = chunks.filter((c) => c.isEntry).map((c) => c.fileName);
  while (stack.length) {
    const f = stack.pop() as string;
    if (reached.has(f)) continue;
    reached.add(f);
    const c = byFile.get(f);
    if (!c) continue;
    stack.push(...(c.imports ?? []));
    for (const d of c.dynamicImports ?? []) {
      // Stop at an on-demand page: what only it reaches stays on demand.
      if (!ON_DEMAND_PAGES.test(byFile.get(d)?.facadeModuleId ?? '')) stack.push(d);
    }
  }
  const skip = new Set(all.filter((f) => bundle[f].type === 'chunk' && !reached.has(f)));
  // Stylesheets that only on-demand chunks import are on demand too.
  const cssOf = (c: BundleItem): string[] => {
    const listed = c.viteMetadata?.importedCss;
    if (listed && listed.size) return [...listed];
    const base = c.fileName.replace(/^assets\//, '').replace(/-[^-]+\.js$/, '');
    return all.filter((f) => f.endsWith('.css') && f.replace(/^assets\//, '').replace(/-[^-]+\.css$/, '') === base);
  };
  const reachedCss = new Set(chunks.filter((c) => reached.has(c.fileName)).flatMap(cssOf));
  for (const c of chunks) if (skip.has(c.fileName)) for (const css of cssOf(c)) if (!reachedCss.has(css)) skip.add(css);
  for (const f of all) if (ON_DEMAND_ASSETS.test(f)) skip.add(f);
  const onDemand = all.filter((f) => skip.has(f));
  return { precache: all.filter((f) => !skip.has(f)).map((f) => `/${f}`), onDemand: onDemand.map((f) => `/${f}`) };
}

const precacheManifest = (): Plugin => ({
  name: 'vinax-precache-manifest',
  // 8.5.3: 'post' — Vite deletes CSS-only chunks from the bundle in its own
  // generateBundle. Run before that, the manifest listed 8 .js files the build
  // never writes; the service worker fetched them on every precache, and
  // before 8.5.2 the edge cached the SPA shell under those urls for a year.
  generateBundle: {
    order: 'post',
    handler(_options, bundle) {
      const { precache, onDemand } = splitPrecache(bundle as unknown as Parameters<typeof splitPrecache>[0]);
      this.emitFile({
        type: 'asset',
        fileName: 'precache-manifest.json',
        source: JSON.stringify({ v: 2, precache, onDemand }),
      });
    },
  },
});

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
  // Playwright owns e2e/ (*.spec.ts run via `npm run e2e`); vitest must not
  // collect them — its default include pattern matches .spec files too.
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**', 'android/**'],
  },
  plugins: [react(), precacheManifest()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  build: {
    // Minification is on (Vite default: esbuild). Only source maps are
    // disabled here — that's a small deterrence measure, not a secrecy claim.
    // There are no secrets in this client and we never rely on client-side
    // obfuscation for security.
    sourcemap: false,
    target: 'es2020',
    // Audio worklets (VinaX AI Live voice's mic tap) load with addModule(),
    // which the CSP allows only from this origin: never inline them as data: URLs.
    assetsInlineLimit: (file: string) => (/\.worklet\.js$/.test(file) ? false : undefined),
    rollupOptions: {
      output: {
        // URL epoch: bump ('b3' → 'b4' …) to change EVERY asset URL at once,
        // side-stepping any edge/browser cache entry poisoned before the
        // _redirects 404 guard existed. Flat paths keep the budget gate simple.
        // b2 → b3 (2026-08-20): the stuck-shell outage cached SPA HTML under
        // /assets/*-b2*.js URLs in users' BROWSER HTTP caches with
        // `immutable, max-age=1y` — no reload, site-data clear, or SW purge
        // ever evicts those, so the b2 URLs are permanently poisoned for
        // affected browsers. New URLs are the only client-side cure.
        entryFileNames: 'assets/[name]-b3[hash].js',
        chunkFileNames: 'assets/[name]-b3[hash].js',
        assetFileNames: 'assets/[name]-b3[hash][extname]',
        // Rolldown-native chunking (Vite 8): same groups as before, plus a
        // size floor so shared app modules merge instead of shipping as
        // nine preloaded micro-chunks (wrapper overhead broke the budget).
        advancedChunks: {
          minSize: 12_000,
          groups: [
            { name: 'router', test: /\/node_modules\/(react-router|react-router-dom)\// },
            { name: 'vendor', test: /\/node_modules\/(react|react-dom|scheduler)\// },
            { name: 'data', test: /\/node_modules\/(@tanstack\/react-query|zustand)\// },
            // v7.0.1 — the small app modules that are ALL already in the first-load
            // graph (each used to ship as its own preloaded 0.1–2 KB chunk, paying a
            // module wrapper and a gzip header apiece). Listed explicitly, never by
            // folder: a pattern wide enough to catch a lazy-only module would drag
            // it into first load. scripts/check-bundle-size.mjs is the referee.
            {
              name: 'core',
              priority: -1,
              test: /\/src\/(utils\/(cn|format|images|plays)|constants\/(languages|storage-keys)|components\/Icons|store\/(reasonStore|toastStore|historyStore|settingsStore)|services\/(together\/session|identity\/installId|native\/index|storage\/local|recommendation\/(quality|songIdentity|identityCore|filters|admission|deadlines)|playback\/session|personalization\/(session|storage|profile|eventWeights)))\.tsx?$/,
            },
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
    // Local dev: run the backend branch's `npm run dev` (wrangler on :8787)
    // alongside vite — /api (incl. /api/cat), /img and /apk all proxy there.
    proxy: Object.fromEntries(
      ['/api', '/img', '/apk'].map((p) => [p, { target: 'http://127.0.0.1:8787', changeOrigin: true }]),
    ),
  },
});
