// 13.6.0 — build-time song, album and artist pages.
//
// Since 11.0.2 the /song|album|artist/* routes are not on the Worker (a
// scraper burned its daily quota through them), so every such URL answered
// with the app shell: home's text and canonical. This step writes real pages
// for the most-listened songs of each hub language and their albums and
// artists, as static files the host serves at no Worker cost:
//
//   dist/song/<slug>-<id>.html   → served at /song/<slug>-<id> (200)
//
// A flat .html file, not a folder: the host answers /song/x from song/x.html
// with a 200, which matches the canonical (no trailing slash, as since
// 4.16.3). A folder would 308 to /song/x/.
//
// The page HTML comes from the Worker's own renderer (entityPage in
// backend/worker/functions/_lib/render.ts) — same text, JSON-LD and share
// tags the edge used to serve — pointed at the public catalogue mirrors,
// NEVER at this site's /api (that would spend the Worker budget).
//
// Runs only on the static host's build (CF_PAGES=1) or with
// PRERENDER_ENTITIES=1. It never fails the build: a dead mirror or the time
// budget just means fewer pages. dist/entity-pages.xml (the sitemap the index
// lists) is always written, with whatever was built.
/* global fetch, AbortController, setTimeout, clearTimeout */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const DIST = process.env.PRERENDER_DIST || 'dist';
const ORIGIN = 'https://www.vinaxmusic.online';
const SHELL_CACHE = 'node_modules/.cache/vinax/shell.html';
const RENDER_TS = resolve(dirname(fileURLToPath(import.meta.url)), '../../backend/worker/functions/_lib/render.ts');
/** Public catalogue mirrors, in order. Never this site's own /api. */
const MIRRORS = ['https://saavn.sumit.co/api', 'https://nepotuneapi.vercel.app/api'];
const LANGS = ['telugu', 'hindi', 'tamil', 'punjabi', 'kannada', 'malayalam', 'bengali', 'marathi', 'bhojpuri', 'gujarati', 'urdu', 'english'];

const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
const SONGS_PER_LANG = num(process.env.ENTITY_SONGS_PER_LANG, 30);
const MAX_ALBUMS = num(process.env.ENTITY_MAX_ALBUMS, 200);
const MAX_ARTISTS = num(process.env.ENTITY_MAX_ARTISTS, 200);
const CONCURRENCY = num(process.env.ENTITY_CONCURRENCY, 6);
const BUDGET_MS = num(process.env.ENTITY_BUDGET_MS, 6 * 60_000);

const enabled = process.env.PRERENDER_ENTITIES === '1' || (process.env.CF_PAGES === '1' && process.env.PRERENDER_ENTITIES !== '0');

function writeSitemap(urls) {
  const today = new Date().toISOString().slice(0, 10);
  const body =
    '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
    urls.map((u) => `<url><loc>${ORIGIN}${u}</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq></url>`).join('') +
    '</urlset>';
  writeFileSync(join(DIST, 'entity-pages.xml'), body);
}

async function getJson(suffix) {
  for (const base of MIRRORS) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      const r = await fetch(`${base}/${suffix}`, { signal: ctrl.signal, headers: { accept: 'application/json' } });
      if (r.ok) {
        const j = await r.json();
        if (j?.data) return j;
      }
    } catch {
      /* next mirror */
    } finally {
      clearTimeout(t);
    }
  }
  return null;
}

/** The pages to build: each language's most-played songs (the same search
 *  seeds the app's charts use, ranked by play count), then their albums and
 *  lead artists. Off-language results and junk (year-only titles, almost no
 *  plays) are dropped. */
export async function pickEntities(get = getJson, langs = LANGS, perLang = SONGS_PER_LANG) {
  const year = new Date().getFullYear();
  const seeds = (l) => [`top ${l} songs ${year}`, `${l} popular songs`, `${l} trending now`];
  const chosen = [];
  const seen = new Set();
  for (const lang of langs) {
    const pool = new Map();
    for (const q of seeds(lang)) {
      const j = await get(`search/songs?query=${encodeURIComponent(q)}&limit=40`);
      for (const s of j?.data?.results ?? []) {
        const id = String(s?.id ?? '');
        if (!/^\w+$/.test(id) || pool.has(id) || seen.has(id)) continue;
        if (String(s?.language ?? '').toLowerCase() !== lang) continue;
        if (/^\s*\d+\s*$/.test(String(s?.name ?? ''))) continue;
        const plays = Number(s?.playCount) || 0;
        if (plays < 10_000) continue;
        pool.set(id, { s, plays });
      }
    }
    // One page per song: the catalogue lists the same song under several ids
    // (versions, re-uploads, singers in another order). Same title and at
    // least one shared singer = the same song; keep the most played.
    const byTitle = new Map();
    let kept = 0;
    for (const { s } of [...pool.values()].sort((a, b) => b.plays - a.plays)) {
      const title = String(s?.name ?? '').toLowerCase().replace(/&[a-z]+;/g, ' ').replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
      const singers = (s?.artists?.primary ?? []).map((a) => String(a?.id ?? '')).filter(Boolean);
      const known = byTitle.get(title) ?? [];
      if (known.some((set) => singers.some((x) => set.has(x)) || (set.size === 0 && singers.length === 0))) continue;
      known.push(new Set(singers));
      byTitle.set(title, known);
      seen.add(String(s.id));
      chosen.push(s);
      if (++kept >= perLang) break;
    }
  }
  const albums = new Set();
  const artists = new Set();
  for (const s of chosen) {
    const al = String(s?.album?.id ?? '');
    if (/^\w+$/.test(al)) albums.add(al);
    for (const a of (s?.artists?.primary ?? []).slice(0, 2)) {
      const ar = String(a?.id ?? '');
      if (/^\w+$/.test(ar)) artists.add(ar);
    }
  }
  return [
    ...chosen.map((s) => ['song', String(s.id)]),
    ...[...albums].slice(0, MAX_ALBUMS).map((id) => ['album', id]),
    ...[...artists].slice(0, MAX_ARTISTS).map((id) => ['artist', id]),
  ];
}

/** Where a rendered page path ("/song/x-1") is written: a flat .html file. */
export function fileFor(path) {
  if (!/^\/(song|album|artist)\/[a-z0-9-]+-\w+$/.test(path)) return null;
  return join(DIST, `${path.slice(1)}.html`);
}

async function main() {
  if (!enabled) {
    writeSitemap([]);
    console.log('entity pages: skipped (static-host builds only; PRERENDER_ENTITIES=1 to run here)');
    return;
  }
  const started = Date.now();
  let shell;
  try {
    shell = readFileSync(SHELL_CACHE, 'utf8');
  } catch {
    writeSitemap([]);
    console.warn('entity pages: no shell (run scripts/prerender.mjs first) — skipped');
    return;
  }
  const vite = await createServer({ logLevel: 'error', server: { middlewareMode: true }, appType: 'custom' });
  const urls = [];
  let failed = 0;
  try {
    const render = await vite.ssrLoadModule(RENDER_TS);
    render.useCatalogBases(MIRRORS);
    const todo = await pickEntities();
    console.log(`entity pages: ${todo.length} to build (${CONCURRENCY} at a time, ${Math.round(BUDGET_MS / 1000)} s budget)`);
    let next = 0;
    const worker = async () => {
      while (next < todo.length && Date.now() - started < BUDGET_MS) {
        const [type, id] = todo[next++];
        try {
          const page = await render.entityPage(type, id, shell);
          const file = page && fileFor(page.path);
          if (!page || !file) {
            failed++;
            continue;
          }
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, page.html);
          urls.push(page.path);
        } catch {
          failed++;
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    const skipped = todo.length - urls.length - failed;
    console.log(
      `entity pages: wrote ${urls.length} (${failed} unavailable${skipped > 0 ? `, ${skipped} left for the time budget` : ''}) in ${Math.round((Date.now() - started) / 1000)} s`,
    );
  } catch (e) {
    console.warn('entity pages: stopped early —', e && e.message);
  } finally {
    writeSitemap(urls.sort());
    await vite.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    () => process.exit(0),
    (e) => {
      console.warn('entity pages: skipped —', e && e.message);
      try {
        writeSitemap([]);
      } catch {
        /* dist missing */
      }
      process.exit(0);
    },
  );
}
