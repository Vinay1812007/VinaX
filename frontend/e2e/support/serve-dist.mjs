/**
 * Static server for the BUILT bundle, used as Playwright's `webServer`
 * (`playwright.config.ts`). Run directly: `node e2e/support/serve-dist.mjs [port]`.
 *
 * Mirrors the static host rather than `vite preview`: files from dist/,
 * directory index (`/admin/` → dist/admin/index.html), `/song/x` served from
 * `song/x.html` (13.6.0 prerendered entity pages), a clean 404 for missing
 * hashed assets, and SPA fallback to index.html for every other route.
 */
/* global URL, process, console */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('../../dist/', import.meta.url));
const MIME = {
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

async function resolveFile(urlPath) {
  let fp = normalize(join(DIST, urlPath));
  if (!fp.startsWith(DIST)) return null;
  let s = await stat(fp).catch(() => null);
  if (s?.isDirectory()) {
    fp = join(fp, 'index.html');
    s = await stat(fp).catch(() => null);
  }
  if (s?.isFile()) return fp;
  const html = `${normalize(join(DIST, urlPath))}.html`;
  if (html.startsWith(DIST) && (await stat(html).catch(() => null))?.isFile()) return html;
  if (urlPath.startsWith('/assets/')) return null;
  return join(DIST, 'index.html');
}

const port = Number(process.argv[2] ?? process.env.PORT ?? 4173);

try {
  await stat(join(DIST, 'index.html'));
} catch {
  console.error(`e2e: dist/index.html is missing. Run \`npm run build\` first (${DIST})`);
  process.exit(1);
}

createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    const fp = await resolveFile(urlPath);
    if (!fp) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
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
}).listen(port, '127.0.0.1', () => {
  console.log(`e2e: serving dist/ on http://localhost:${port}`);
});
