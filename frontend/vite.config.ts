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
/** 7.2.0 — the diagram and maths engines behind VinaX AI replies (and every
 *  chunk only they reach). A reply that needs them needs the network anyway,
 *  so they are ON DEMAND: fetched and runtime-cached on first use, never
 *  pruned afterwards — instead of ~1.6 MB gzip precached for every listener. */
const RICH_RENDER_ROOT = /[\\/]node_modules[\\/](?:mermaid|katex)[\\/]/;
/** The maths typeface (three formats each) and its stylesheet. */
const ON_DEMAND_ASSET = /^assets\/(?:KaTeX_[^/]*|katex[^/]*\.css)$/;

/** Split the build's assets into what the service worker precaches and what it fetches on demand. */
export function splitPrecache(bundle: Record<string, { type: 'chunk' | 'asset'; fileName: string; isEntry?: boolean; facadeModuleId?: string | null; imports?: string[]; dynamicImports?: string[] }>): { precache: string[]; onDemand: string[] } {
  const all = Object.keys(bundle).filter((f) => f.startsWith('assets/')).sort();
  const chunks = Object.values(bundle).filter((c) => c.type === 'chunk');
  const byFile = new Map(chunks.map((c) => [c.fileName, c]));
  const roots = new Set(chunks.filter((c) => c.facadeModuleId && RICH_RENDER_ROOT.test(c.facadeModuleId)).map((c) => c.fileName));
  const reached = new Set<string>();
  const stack = chunks.filter((c) => c.isEntry).map((c) => c.fileName);
  while (stack.length) {
    const f = stack.pop() as string;
    if (reached.has(f) || roots.has(f)) continue;
    reached.add(f);
    const c = byFile.get(f);
    if (c) stack.push(...(c.imports ?? []), ...(c.dynamicImports ?? []));
  }
  const onDemand = all.filter((f) => (bundle[f].type === 'chunk' ? !reached.has(f) : ON_DEMAND_ASSET.test(f)));
  const skip = new Set(onDemand);
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
