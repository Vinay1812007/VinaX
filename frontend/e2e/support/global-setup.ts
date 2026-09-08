/**
 * vitest global setup for the e2e specs: serves the BUILT bundle (dist/) on
 * an ephemeral localhost port and hands the origin to every spec via
 * `inject('baseURL')` (the `page` fixture uses it as the context baseURL, so
 * `page.goto('/settings')` works like it does under the stock runner).
 *
 * Mirrors what `vite preview` does for the app: static files, directory
 * index (so `/admin/` → dist/admin/index.html), SPA fallback to index.html
 * for unknown routes, and a clean 404 for missing hashed assets.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestProject } from 'vitest/node';

const DIST = fileURLToPath(new URL('../../dist/', import.meta.url));
const MIME: Record<string, string> = {
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain',
  '.xml': 'application/xml',
};

async function resolveFile(urlPath: string): Promise<string | null> {
  let fp = normalize(join(DIST, urlPath));
  if (!fp.startsWith(DIST)) return null;
  let s = await stat(fp).catch(() => null);
  if (s?.isDirectory()) {
    fp = join(fp, 'index.html');
    s = await stat(fp).catch(() => null);
  }
  if (s?.isFile()) return fp;
  if (urlPath.startsWith('/assets/')) return null;
  return join(DIST, 'index.html');
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  await stat(join(DIST, 'index.html')).catch(() => {
    throw new Error(`e2e: dist/index.html is missing — run \`npm run build\` first (${DIST})`);
  });
  const server = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
      const fp = await resolveFile(urlPath);
      if (!fp) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        return res.end('not found');
      }
      const body = await readFile(fp);
      res.writeHead(200, {
        'content-type': MIME[extname(fp)] ?? 'application/octet-stream',
        'x-content-type-options': 'nosniff',
        'cache-control': 'no-store',
      });
      res.end(body);
    } catch (e) {
      res.writeHead(500);
      res.end(String(e));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  project.provide('baseURL', `http://localhost:${port}`);
  return async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
}
