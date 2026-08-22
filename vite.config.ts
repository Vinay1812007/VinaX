/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { onRequestGet as catalogGet } from './worker/functions/api/cat/[[path]]';

const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')) as {
  version: string;
};

const BUILD_NUMBER = process.env.VITE_BUILD_NUMBER || '';
const APP_VERSION = BUILD_NUMBER ? `${pkg.version}+${BUILD_NUMBER}` : pkg.version;

function localCatalogPlugin(): Plugin {
  return {
    name: 'vinax-local-catalog',
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        if (req.method !== 'GET' || !String(req.url || '').startsWith('/api/cat')) {
          next();
          return;
        }

        try {
          const host = req.headers.host || 'localhost:5173';
          const protocol = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0];
          const request = new Request(`${protocol}://${host}${req.url || '/api/cat'}`, {
            method: 'GET',
            headers: new Headers(
              Object.entries(req.headers).reduce<Record<string, string>>((acc, [key, value]) => {
                if (value !== undefined) acc[key] = Array.isArray(value) ? value.join(', ') : value;
                return acc;
              }, {}),
            ),
          });

          const parsed = new URL(request.url);
          const prefix = '/api/cat';
          const rest = parsed.pathname.startsWith(prefix) ? parsed.pathname.slice(prefix.length) : '';
          const path = rest.split('/').filter(Boolean).map(decodeURIComponent);
          const response = await catalogGet({ request, params: { path } });

          res.statusCode = response.status;
          response.headers.forEach((value, key) => {
            res.setHeader(key, value);
          });
          const body = Buffer.from(await response.arrayBuffer());
          res.end(body);
        } catch (error) {
          console.error('[vinax:local-catalog] request failed', error);
          res.statusCode = 502;
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ success: false, data: null, error: 'Local catalog proxy failed' }));
        }
      });
    },
  };
}

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
  // Playwright owns e2e/ (*.spec.ts run via `npm run e2e`); vitest must not
  // collect them — its default include pattern matches .spec files too.
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**', 'android/**'],
  },
  plugins: [react(), localCatalogPlugin()],
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
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
    // Local dev: run `npm run dev:worker` (wrangler on :8787) alongside vite.
    proxy: Object.fromEntries(
      ['/api', '/img', '/apk'].map((p) => [p, { target: 'http://127.0.0.1:8787', changeOrigin: true }]),
    ),
  },
});
