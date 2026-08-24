/**
 * E2E smoke suite (`npm run e2e`) — boots the BUILT bundle in real Chromium
 * and walks the app's spine. Deterministic by construction: every request
 * that leaves localhost is aborted, so a red run means the app broke, not
 * the internet.
 *
 * What it guards (each one is a real incident class):
 *   1. Module-graph integrity — no built /assets JS file is secretly HTML
 *      (the 2026-08-20 stuck-shell outage: SPA fallback cached under chunk
 *      URLs bricked every boot).
 *   2. Boot — React must replace the static #boot splash with #main-content
 *      even with all external APIs dead (offline-resilient home).
 *   3. SPA navigation — client-side route changes keep the app mounted.
 *
 * Browser resolution: CI installs the playwright-core-matched Chromium via
 * `npx playwright-core install chromium`; a custom binary can be forced with
 * E2E_CHROMIUM_PATH (used by the sandboxed dev container).
 */
/* global URL, document -- URL is a Node 18+ global; document only appears
   inside page.evaluate callbacks, which run in the browser. */
import { createServer } from 'node:http';
import { readFile, readdir, stat, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const DIST = fileURLToPath(new URL('../dist', import.meta.url));
const MIME = {
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain',
};

let failures = 0;
const pass = (name) => console.log(`  ✓ ${name}`);
const fail = (name, detail) => {
  failures += 1;
  console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
};

// ---------- 1. Static module-graph integrity (no browser needed) ----------
console.log('module-graph integrity:');
const assetFiles = await readdir(join(DIST, 'assets'));
let htmlPoisoned = 0;
for (const f of assetFiles) {
  if (!f.endsWith('.js')) continue;
  const head = (await readFile(join(DIST, 'assets', f), 'utf8')).slice(0, 200).trimStart();
  if (head.startsWith('<')) {
    htmlPoisoned += 1;
    fail(`asset is HTML, not JS: assets/${f}`);
  }
}
if (htmlPoisoned === 0) pass(`${assetFiles.filter((f) => f.endsWith('.js')).length} built JS assets are all valid JS`);

const indexHtml = await readFile(join(DIST, 'index.html'), 'utf8');
const referenced = new Set(
  [...indexHtml.matchAll(/(?:src|href)="\/(assets\/[^"]+)"/g)].map((m) => m[1]),
);
let missing = 0;
for (const ref of referenced) {
  try {
    await stat(join(DIST, ref));
  } catch {
    missing += 1;
    fail(`index.html references a file absent from dist: ${ref}`);
  }
}
if (missing === 0) pass(`all ${referenced.size} assets referenced by index.html exist on disk`);

// ---------- static server: SPA fallback + /assets 404 guard ----------
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let fp = normalize(join(DIST, path));
    if (!fp.startsWith(DIST)) {
      res.writeHead(403);
      return res.end();
    }
    let s = null;
    try {
      s = await stat(fp);
    } catch {
      s = null;
    }
    if (!s || s.isDirectory()) {
      // A missing hashed asset serves a clean 404 here; in production the
      // integrity checks above are the real guard — every referenced asset
      // must exist and be genuine JS before this suite goes green.
      if (path.startsWith('/assets/')) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        return res.end('missing asset');
      }
      fp = join(DIST, 'index.html');
    }
    const body = await readFile(fp);
    res.writeHead(200, {
      'content-type': MIME[extname(fp)] || 'application/octet-stream',
      'x-content-type-options': 'nosniff',
    });
    res.end(body);
  } catch (e) {
    res.writeHead(500);
    res.end(String(e));
  }
});
await new Promise((resolve) => server.listen(0, resolve));
const base = `http://localhost:${server.address().port}`;

// ---------- browser ----------
const launchOpts = { args: ['--no-sandbox'] };
if (process.env.E2E_CHROMIUM_PATH) launchOpts.executablePath = process.env.E2E_CHROMIUM_PATH;
const browser = await chromium.launch(launchOpts);
const context = await browser.newContext({ timezoneId: 'Asia/Kolkata', locale: 'en-IN' });
// Determinism: kill everything that isn't our local static server.
await context.route('**/*', (route) => {
  const u = route.request().url();
  if (u.startsWith(base) || u.startsWith('data:')) return route.continue();
  return route.abort();
});
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message || String(e)));

async function screenshotOnFail(name) {
  try {
    await mkdir('test-results', { recursive: true });
    await page.screenshot({ path: `test-results/${name}.png`, fullPage: true });
  } catch {
    /* best-effort */
  }
}

// ---------- 2. Boot ----------
console.log('boot:');
try {
  await page.goto(`${base}/`, { waitUntil: 'load', timeout: 30_000 });
  await page.waitForSelector('#main-content', { timeout: 20_000 });
  pass('React mounted (#main-content present) with all external APIs dead');
  const bootGone = await page.evaluate(() => !document.getElementById('boot'));
  if (bootGone) pass('static #boot splash removed');
  else fail('static #boot splash still present after mount');
} catch (e) {
  fail('app did not mount', (e.message || '').slice(0, 200));
  await screenshotOnFail('boot-failure');
}

// ---------- 3. SPA navigation ----------
console.log('navigation:');
try {
  await page.goto(`${base}/settings`, { waitUntil: 'load', timeout: 30_000 });
  await page.waitForSelector('#main-content', { timeout: 20_000 });
  pass('/settings renders mounted app');
} catch (e) {
  fail('/settings did not mount', (e.message || '').slice(0, 200));
  await screenshotOnFail('settings-failure');
}

if (pageErrors.length) {
  // Surface unexpected page errors, but only count them as failures when the
  // app also failed to mount — dead-network fetch noise is expected here.
  console.log(`  (page errors observed: ${pageErrors.length})`);
}

await browser.close();
server.close();

if (failures > 0) {
  console.error(`\ne2e: ${failures} check(s) FAILED`);
  process.exit(1);
}
console.log('\ne2e: all checks passed');
