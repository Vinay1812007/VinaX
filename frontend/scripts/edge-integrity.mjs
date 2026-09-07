/**
 * Edge module-graph integrity — the canary for the stuck-shell outage class.
 *
 * scripts/e2e-smoke.mjs already proves the BUILT dist is sane. This proves the
 * DEPLOYED edge is: it fetches the live shell exactly as a browser would and
 * checks that every asset it references really answers with JavaScript.
 *
 * Why it exists (2026-09-07): a request for the entry chunk landed during a
 * deploy window and was answered with the SPA fallback — an HTML body — which
 * the `/assets/* max-age=31536000` rule then cached at the edge for a year.
 * The file was perfectly fine at origin; only the cache entry was poisoned, so
 * nothing in the build, the tests or the dist could see it. Every visitor got
 * HTML where a module was expected, the app never booted, and the boot shell
 * sat on "Updating…" — a total outage invisible to every existing check.
 *
 * Usage: node scripts/edge-integrity.mjs [origin]
 *   exit 0 = every referenced asset is real JS/CSS
 *   exit 1 = at least one is poisoned or missing (message names it)
 */
const ORIGIN = (process.argv[2] || process.env.VINAX_ORIGIN || 'https://www.sirimillavinay.online').replace(/\/$/, '');
const UA = 'VinaX-edge-canary/1.0';

const get = async (url, tries = 3) => {
  let last;
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow' });
      return { res, body: await res.text() };
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw last;
};

let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.error(`  ✗ ${msg}`);
};

console.log(`edge integrity: ${ORIGIN}`);

const { res: shellRes, body: shell } = await get(`${ORIGIN}/`);
if (!shellRes.ok) fail(`app shell responded ${shellRes.status}`);
if (!/vinax/i.test(shell)) fail('app shell body does not mention VinaX');

const refs = [...new Set([...shell.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]))];
if (refs.length === 0) fail('app shell references no /assets/* files at all');
console.log(`  shell references ${refs.length} assets`);

for (const path of refs) {
  const url = `${ORIGIN}${path}`;
  let out;
  try {
    out = await get(url);
  } catch (e) {
    fail(`${path} — request failed: ${e && e.message}`);
    continue;
  }
  const { res, body } = out;
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  const head = body.slice(0, 200).trimStart();
  if (!res.ok) {
    fail(`${path} — HTTP ${res.status}`);
    continue;
  }
  // The poison signature: a 200 whose body is a document, not a module.
  if (head.startsWith('<')) {
    fail(
      `${path} — served HTML, not JS (cf-cache-status: ${res.headers.get('cf-cache-status') || 'n/a'}, ` +
        `age: ${res.headers.get('age') || 'n/a'}, cache-control: ${res.headers.get('cache-control') || 'n/a'}). ` +
        'A non-JS body is cached under a hashed chunk URL — purge this URL at the CDN and redeploy with a new hash.',
    );
    continue;
  }
  const wantJs = path.endsWith('.js');
  if (wantJs && !/javascript|ecmascript/.test(ct)) fail(`${path} — content-type is "${ct}", expected JavaScript`);
  if (!wantJs && path.endsWith('.css') && !ct.includes('css')) fail(`${path} — content-type is "${ct}", expected CSS`);
}

if (failures) {
  console.error(`\nedge integrity FAILED — ${failures} problem(s). The deployed app cannot boot.`);
  process.exit(1);
}
console.log(`  ✓ all ${refs.length} deployed assets serve the right type`);
