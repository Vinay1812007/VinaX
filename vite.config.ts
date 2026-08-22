import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')) as {
  version: string;
};

const BUILD_NUMBER = process.env.VITE_BUILD_NUMBER || '';
const APP_VERSION = BUILD_NUMBER ? `${pkg.version}+${BUILD_NUMBER}` : pkg.version;

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
  plugins: [react()],
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
        // URL epoch: bump ('b2' → 'b3' …) to change EVERY asset URL at once,
        // side-stepping any edge/browser cache entry poisoned before the
        // _redirects 404 guard existed. Flat paths keep the budget gate simple.
        entryFileNames: 'assets/[name]-b2[hash].js',
        chunkFileNames: 'assets/[name]-b2[hash].js',
        assetFileNames: 'assets/[name]-b2[hash][extname]',
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
    // Local dev: run `npm run dev:worker` (wrangler on :8787) alongside vite;
    // backend paths are proxied to the Worker.
    proxy: Object.fromEntries(
      ['/api', '/img', '/apk'].map((p) => [
        p,
        { target: 'http://127.0.0.1:8787', changeOrigin: true },
      ]),
    ),
  },
});
