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
//
// V2 1.0 — the SEO pages cost NO Worker requests at all. Every build also
// writes, as static files:
//
//   dist/<lang>-<mood>-songs.html   the 72 mood × language hubs (renderHub)
//   dist/sitemap.xml                the sitemap index
//   dist/sitemap-static.xml         the prerendered app routes
//   dist/sitemap-hubs.xml           the hubs
//
// from the Worker's own renderer and sitemap handlers, so the words and the
// URLs are the ones the edge used to answer with. Their Worker routes are
// gone (backend/worker/wrangler.toml): a crawler reading the whole site now
// spends nothing from the daily request quota. The songs each hub lists are
// built first, so a hub's links land on real pages.
/* global fetch, AbortController, setTimeout, clearTimeout, Request, Response */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const DIST = process.env.PRERENDER_DIST || 'dist';
const ORIGIN = 'https://www.vinaxmusic.online';
const SHELL_CACHE = 'node_modules/.cache/vinax/shell.html';
const RENDER_TS = resolve(dirname(fileURLToPath(import.meta.url)), '../../backend/worker/functions/_lib/render.ts');
/**
 * Catalogue sources, in order. Never this site's own /api (that is the
 * Worker and would spend its daily request budget). 2026-11-05: VinaX's own
 * catalogue API (musicapi.vinaxmusic.online, on Render, not a Worker route)
 * comes first: the public mirrors answered 429 and 402 that day, and a build
 * shipped with no song, album or artist pages at all.
 */
export const MIRRORS = ['https://musicapi.vinaxmusic.online/api', 'https://saavn.sumit.co/api', 'https://nepotuneapi.vercel.app/api'];
/**
 * A static-host build that writes fewer entity pages than this fails, so the
 * host keeps the last good deployment instead of replacing every song, album
 * and artist page with a 404 (ENTITY_MIN_PAGES=0 turns the check off).
 */
const MIN_PAGES = Number.isFinite(Number(process.env.ENTITY_MIN_PAGES)) && process.env.ENTITY_MIN_PAGES !== '' && process.env.ENTITY_MIN_PAGES !== undefined ? Number(process.env.ENTITY_MIN_PAGES) : 300;

/** True when a build wrote too few entity pages to replace the live site. */
export function tooFewPages(written, enabledHere, min = MIN_PAGES) {
  return enabledHere && min > 0 && written < min;
}
const LANGS = ['telugu', 'hindi', 'tamil', 'punjabi', 'kannada', 'malayalam', 'bengali', 'marathi', 'bhojpuri', 'gujarati', 'urdu', 'english'];

const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
const SONGS_PER_LANG = num(process.env.ENTITY_SONGS_PER_LANG, 30);
const MAX_ALBUMS = num(process.env.ENTITY_MAX_ALBUMS, 400);
const MAX_ARTISTS = num(process.env.ENTITY_MAX_ARTISTS, 400);
/** Songs linked from the hubs, built ahead of the chart picks (V2 1.0). */
const MAX_HUB_SONGS = num(process.env.ENTITY_MAX_HUB_SONGS, 1500);
/** SEO 2026-11 — pages the built pages link to most, built next while the time budget lasts. */
/** Like num(), but 0 is a real value (a push build adds no new pages). */
const num0 = (v, d) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
// New pages per build. Cloudflare's own builds (every push) add a few; the
// daily GitHub job (.github/workflows/seo-pages.yml) sets 3,000.
const MAX_LINKED = num0(process.env.ENTITY_MAX_LINKED, 300);
/**
 * SEO 2026-11 (daily growth). Every build keeps the pages the site already
 * has: a page store (ENTITY_CORPUS_DIR; the daily GitHub job caches it between
 * runs) holds each page's unpruned HTML, and anything the live sitemap lists
 * that the store lacks is downloaded from the live site first
 * (ENTITY_SEED_FROM; static files, no Worker requests; '' turns it off). The
 * charts' pages are rebuilt, the ENTITY_REFRESH oldest stored pages are
 * re-rendered, and up to ENTITY_MAX_LINKED new pages the others link to are
 * added, until ENTITY_MAX_TOTAL pages, and never past the static host's file
 * limit (PAGES_FILE_LIMIT, 20,000 on the Free plan).
 */
const CORPUS_DIR = resolve(process.env.ENTITY_CORPUS_DIR || 'node_modules/.cache/vinax/seo-corpus');
const SEED_FROM = (process.env.ENTITY_SEED_FROM ?? ORIGIN).replace(/\/$/, '');
const MAX_TOTAL = num(process.env.ENTITY_MAX_TOTAL, 17_000);
const REFRESH = num0(process.env.ENTITY_REFRESH, 0);
const FILE_LIMIT = num(process.env.PAGES_FILE_LIMIT, 20_000);
/** Files kept free under the host's limit, for whatever else a release adds. */
const FILE_MARGIN = 300;
/** A build may not drop more than this share of the pages the live site has. */
const KEEP_SHARE = 0.8;
const CONCURRENCY = num(process.env.ENTITY_CONCURRENCY, 8);
const BUDGET_MS = num(process.env.ENTITY_BUDGET_MS, 12 * 60_000);
const WORKER_FN = resolve(dirname(fileURLToPath(import.meta.url)), '../../backend/worker/functions');
/** The mood × language hubs, as functions/sitemap-hubs.xml.ts lists them. */
export const HUB_MOODS = ['romantic', 'sad', 'party', 'devotional', 'melody', 'workout'];
export const HUB_PATHS = LANGS.flatMap((l) => HUB_MOODS.map((m) => `/${l}-${m}-songs`));
/** The sitemaps written as static files, and the Worker handler each comes from. */
export const STATIC_SITEMAPS = [
  ['sitemap.xml', 'sitemap.xml.ts'],
  ['sitemap-static.xml', 'sitemap-static.xml.ts'],
  ['sitemap-hubs.xml', 'sitemap-hubs.xml.ts'],
];

const enabled = process.env.PRERENDER_ENTITIES === '1' || (process.env.CF_PAGES === '1' && process.env.PRERENDER_ENTITIES !== '0');

function writeSitemap(urls) {
  const body =
    '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
    // No per-URL lastmod: it was always "today" (every build), which Google learns to ignore.
    urls.map((u) => `<url><loc>${ORIGIN}${u}</loc></url>`).join('') +
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
export async function pickEntities(get = getJson, langs = LANGS, perLang = SONGS_PER_LANG, info = new Map()) {
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
      // What the song lists on Charts, Top Songs, Trending and the language pages show.
      info.set(String(s.id), {
        lang,
        title: String(s?.name ?? '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#0?39;/g, "'"),
        artist: (s?.artists?.primary ?? []).slice(0, 2).map((a) => String(a?.name ?? '')).filter(Boolean).join(', '),
        year: Number(s?.year) || 0,
        plays: Number(s?.playCount) || 0,
      });
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

/** The song ids a rendered hub page links to, in its order. */
export function hubSongIds(html) {
  const out = [];
  for (const m of String(html).matchAll(/href="\/song\/([\w-]+)"/g)) {
    const id = songIdOf(m[1]);
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/** Where a hub page is written: a flat .html file, served at the path with a 200. */
export function hubFileFor(path) {
  if (!HUB_PATHS.includes(path)) return null;
  return join(DIST, `${path.slice(1)}.html`);
}

/** Write the static sitemaps from the Worker's own handlers. */
async function writeStaticSitemaps(vite) {
  for (const [file, mod] of STATIC_SITEMAPS) {
    const m = await vite.ssrLoadModule(join(WORKER_FN, mod));
    const res = await m.onRequestGet({});
    writeFileSync(join(DIST, file), await res.text());
  }
}

/** Render the 72 hubs into dist; returns the song ids they link to. */
async function writeHubs(render, shell) {
  const env = { ASSETS: { fetch: async () => new Response(shell, { headers: { 'content-type': 'text/html' } }) } };
  const songs = [];
  let written = 0;
  const todo = [...HUB_PATHS];
  const worker = async () => {
    while (todo.length) {
      const path = todo.shift();
      const hub = render.matchHub(path);
      const file = hubFileFor(path);
      if (!hub || !file) continue;
      try {
        const res = await render.renderHub(hub.lang, hub.mood, new Request(`${ORIGIN}${path}`), env);
        const html = await res.text();
        if (!res.ok || !html.includes('seo-content')) continue;
        writeFileSync(file, html);
        written++;
        songs.push(...hubSongIds(html));
      } catch {
        /* this hub keeps the app shell */
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`hub pages: wrote ${written} of ${HUB_PATHS.length}`);
  return [...new Set(songs)];
}

/**
 * The id in "<slug>-<id>". Song ids are 8 characters and may contain "-"
 * (H7SU6-O2); the slug is lowercase, so a last piece shorter than an id means
 * the id is the last 8 characters (same rule as songIdOf in render.ts and
 * extractSongId in src/utils/slug.ts). Album and artist ids are plain.
 */
export function songIdOf(param) {
  const p = String(param);
  const last = p.split('-').pop() ?? '';
  if (last.length >= 8 || p.length < 8) return last || p;
  return p.length === 8 || p[p.length - 9] === '-' ? p.slice(-8) : last || p;
}

/** "song:<id>" for an entity page path ("/song/some-title-<id>"), or null. */
export function entityKey(path) {
  const m = /^\/(song|album|artist)\/([\w-]+)$/.exec(String(path));
  if (!m) return null;
  return `${m[1]}:${m[1] === 'song' ? songIdOf(m[2]) : m[2].split('-').pop()}`;
}

const ENTITY_LINK = /<a href="(\/(?:song|album|artist)\/[\w-]+)">([\s\S]*?)<\/a>/g;

/** Entity pages a rendered page links to, as "type:id" keys, with how often. */
export function linkedEntities(html, counts = new Map()) {
  for (const m of String(html).matchAll(ENTITY_LINK)) {
    const k = entityKey(m[1]);
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

/**
 * SEO 2026-11 — a link to a song, album or artist page that was not built
 * would land a crawler on the 404 app shell, so it becomes plain text; a link
 * to a built page whose slug differs points at the built path. `built` maps
 * "type:id" to the built page's path.
 */
export function pruneEntityLinks(html, built) {
  return String(html).replace(ENTITY_LINK, (m, href, text) => {
    const path = built.get(entityKey(href) ?? '');
    return path ? `<a href="${path}">${text}</a>` : text;
  });
}

const escHtml = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const capWord = (w) => w.charAt(0).toUpperCase() + w.slice(1);

/** An <ol> of built song pages: "Title — Artist". */
function songOl(rows) {
  return `<ol>${rows.map((r) => `<li><a href="${r.path}">${escHtml(r.title)}</a>${r.artist ? ` — ${escHtml(r.artist)}` : ''}</li>`).join('')}</ol>`;
}

/**
 * The song lists the prerendered Charts, Top Songs, Trending and language
 * pages carry for crawlers (before SEO 2026-11 they linked to no song at
 * all). `rows` are built songs: { path, lang, title, artist, year, plays }.
 * Returns { '/charts': html, ... } keyed by route.
 */
export function songSections(rows, year = new Date().getFullYear()) {
  const byPlays = [...rows].sort((a, b) => b.plays - a.plays);
  const langs = [...new Set(LANGS.filter((l) => byPlays.some((r) => r.lang === l)))];
  const out = {};
  if (!byPlays.length) return out;
  out['/charts'] = langs
    .map((l) => `<h2>Top ${capWord(l)} songs</h2>${songOl(byPlays.filter((r) => r.lang === l).slice(0, 10))}<p><a href="/${l}-songs/">More ${capWord(l)} songs</a></p>`)
    .join('');
  out['/top-songs'] = `<h2>The 50 most played songs</h2>${songOl(byPlays.slice(0, 50))}`;
  const fresh = byPlays.filter((r) => r.year >= year - 1).slice(0, 40);
  if (fresh.length) out['/trending'] = `<h2>Popular new songs from ${year - 1} and ${year}</h2>${songOl(fresh)}`;
  for (const l of langs) {
    out[`/${l}-songs`] = `<h2>Top ${capWord(l)} songs right now</h2>${songOl(byPlays.filter((r) => r.lang === l).slice(0, 30))}`;
  }
  return out;
}

/** Put a section into a prerendered page, just before its site nav. */
export function injectSection(html, section) {
  const at = String(html).indexOf('<nav aria-label="Browse VinaX">');
  if (!section || at < 0) return html;
  return html.slice(0, at) + section + html.slice(at);
}

/** The <loc> paths ("/song/x-1") of an entity sitemap on this site. */
export function sitemapPaths(xml) {
  const out = [];
  for (const m of String(xml).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
    if (!m[1].startsWith(`${ORIGIN}/`)) continue;
    const path = m[1].slice(ORIGIN.length);
    if (entityKey(path)) out.push(path);
  }
  return out;
}

/**
 * How many entity pages this build may hold: the configured total, but never
 * so many that the deployment passes the host's file limit.
 */
export function pageRoom(otherFiles, maxTotal = MAX_TOTAL, fileLimit = FILE_LIMIT, margin = FILE_MARGIN) {
  return Math.max(0, Math.min(maxTotal, fileLimit - margin - otherFiles));
}

/**
 * The new pages to build: the ones built pages link to most, that are neither
 * built nor already tried, at most `max` and only while `room` lasts.
 */
export function nextPages(links, built, tried, room, max) {
  const take = Math.max(0, Math.min(max, room));
  return [...links.entries()]
    .filter(([k]) => !built.has(k) && !tried.has(k))
    .sort((a, b) => b[1] - a[1])
    .slice(0, take)
    .map(([k]) => k.split(':'));
}

/** The fewest pages this build may write: the floor, and most of what is live. */
export function minimumPages(liveCount, floor = MIN_PAGES, keep = KEEP_SHARE) {
  return floor > 0 ? Math.max(floor, Math.floor((Number(liveCount) || 0) * keep)) : 0;
}

/** Every file under a directory, counted (the static host's limit is per file). */
function countFiles(dir) {
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) n += e.isDirectory() ? countFiles(join(dir, e.name)) : 1;
  return n;
}

/** The page store: manifest + one unpruned HTML file per page. */
function storeFile(path) {
  return join(CORPUS_DIR, 'pages', `${path.slice(1)}.html`);
}
function loadStore() {
  try {
    const m = JSON.parse(readFileSync(join(CORPUS_DIR, 'manifest.json'), 'utf8'));
    const out = new Map();
    for (const [key, v] of Object.entries(m?.pages ?? {})) {
      if (v && typeof v.path === 'string' && entityKey(v.path) === key && existsSync(storeFile(v.path))) out.set(key, { path: v.path, at: Number(v.at) || 0 });
    }
    return out;
  } catch {
    return new Map();
  }
}
function saveStore(store) {
  mkdirSync(CORPUS_DIR, { recursive: true });
  const pages = {};
  for (const [key, v] of store) pages[key] = { path: v.path, at: v.at };
  writeFileSync(join(CORPUS_DIR, 'manifest.json'), JSON.stringify({ version: 1, pages }));
}
function putStore(store, key, path, html, at) {
  const f = storeFile(path);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, html);
  store.set(key, { path, at });
}

/**
 * Pages the live site lists but the store lacks, downloaded from the live
 * site (static files: no Worker requests). Answers how many the live sitemap
 * lists, or null when it could not be read.
 */
async function seedFromLive(store, skip) {
  if (!SEED_FROM) return null;
  let paths;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20_000);
    const r = await fetch(`${SEED_FROM}/entity-pages.xml`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    paths = sitemapPaths(await r.text());
  } catch (e) {
    console.warn(`entity pages: could not read the live sitemap (${e && e.message}) — building without it`);
    return null;
  }
  const todo = paths.filter((p) => {
    const k = entityKey(p);
    return k && !store.has(k) && !skip.has(k);
  });
  let got = 0;
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const path = todo[next++];
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15_000);
      try {
        const r = await fetch(`${SEED_FROM}${path}`, { signal: ctrl.signal, headers: { 'user-agent': 'VinaX-build' } });
        const html = r.ok ? await r.text() : '';
        // Only the real page (its own canonical), never the 404 app shell.
        if (html.includes('id="seo-content"') && html.includes(`<link rel="canonical" href="${ORIGIN}${path}"`)) {
          putStore(store, entityKey(path), path, html, 0);
          got++;
        }
      } catch {
        /* that page is rebuilt or added again later */
      } finally {
        clearTimeout(t);
      }
    }
  };
  await Promise.all(Array.from({ length: 16 }, worker));
  console.log(`entity pages: the live site lists ${paths.length}; ${todo.length} were missing here, ${got} downloaded`);
  return paths.length;
}

/** Where a rendered page path ("/song/x-1") is written: a flat .html file. */
export function fileFor(path) {
  if (!/^\/(song|album|artist)\/[\w-]+$/.test(path)) return null;
  return join(DIST, `${path.slice(1)}.html`);
}

/**
 * After the build: song lists into the prerendered Charts, Top Songs,
 * Trending and language pages, then every built page and hub has its links
 * to pages that were not built turned into plain text.
 */
function finishPages(built, info) {
  const rows = [];
  for (const [id, s] of info) {
    const path = built.get(`song:${id}`);
    if (path) rows.push({ path, ...s });
  }
  let injected = 0;
  for (const [route, section] of Object.entries(songSections(rows))) {
    const file = join(DIST, route.slice(1), 'index.html');
    try {
      const html = readFileSync(file, 'utf8');
      const out = injectSection(html, section);
      if (out !== html) {
        writeFileSync(file, out);
        injected++;
      }
    } catch {
      /* that page was not prerendered */
    }
  }
  const files = [...built.values()].map(fileFor).concat(HUB_PATHS.map(hubFileFor)).filter(Boolean);
  let pruned = 0;
  for (const file of files) {
    try {
      const html = readFileSync(file, 'utf8');
      const out = pruneEntityLinks(html, built);
      if (out !== html) {
        writeFileSync(file, out);
        pruned++;
      }
    } catch {
      /* not written */
    }
  }
  console.log(`entity pages: song lists on ${injected} pages; links to unbuilt pages removed on ${pruned}`);
}

async function main() {
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
  /** How many entity pages the live site lists (null when unknown). */
  let liveCount = null;
  try {
    await writeStaticSitemaps(vite);
    const render = await vite.ssrLoadModule(RENDER_TS);
    // Off the static host the hubs are written without their song lists (no network, same words and links).
    render.useCatalogBases(enabled ? MIRRORS : []);
    const hubSongs = await writeHubs(render, shell);
    if (!enabled) {
      console.log('entity pages: skipped (static-host builds only; PRERENDER_ENTITIES=1 to run here)');
      return;
    }
    const info = new Map();
    const picked = await pickEntities(getJson, LANGS, SONGS_PER_LANG, info);
    const fromHubs = hubSongs.slice(0, MAX_HUB_SONGS).map((id) => ['song', id]);
    const have = new Set(fromHubs.map(([, id]) => id));
    const todo = [...fromHubs, ...picked.filter(([t, id]) => t !== 'song' || !have.has(id))];
    const room = pageRoom(countFiles(DIST));
    // The pages the site already has: the store, plus whatever the live sitemap lists that it lacks.
    const store = loadStore();
    liveCount = await seedFromLive(store, new Set(todo.map(([t, id]) => `${t}:${id}`)));
    console.log(`entity pages: ${store.size} kept from earlier builds; ${todo.length} chart pages to rebuild; room for ${room} (${CONCURRENCY} at a time, ${Math.round(BUDGET_MS / 1000)} s budget)`);
    /** "type:id" → the built page's path; and every built page's links, counted. */
    const built = new Map();
    const tried = new Set();
    const links = new Map();
    let rendered = 0;
    const buildAll = async (list) => {
      let next = 0;
      const worker = async () => {
        while (next < list.length && Date.now() - started < BUDGET_MS) {
          const [type, id] = list[next++];
          const key = `${type}:${id}`;
          if (tried.has(key)) continue;
          if (!built.has(key) && built.size >= room) continue;
          tried.add(key);
          try {
            const page = await render.entityPage(type, id, shell);
            const file = page && fileFor(page.path);
            if (!page || !file) {
              failed++;
              continue;
            }
            const k = entityKey(page.path) ?? key;
            // A song renamed in the catalogue gets a new address; drop the old copy.
            const old = store.get(k);
            if (old && old.path !== page.path) store.delete(k);
            mkdirSync(dirname(file), { recursive: true });
            writeFileSync(file, page.html);
            putStore(store, k, page.path, page.html, Date.now());
            built.set(k, page.path);
            linkedEntities(page.html, links);
            rendered++;
          } catch {
            failed++;
          }
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      return list.length - next;
    };
    let skipped = await buildAll(todo);
    // The oldest kept pages are rendered again, so their text and links stay current.
    if (REFRESH > 0) {
      const oldest = [...store.entries()]
        .filter(([k]) => !tried.has(k))
        .sort((a, b) => a[1].at - b[1].at)
        .slice(0, REFRESH)
        .map(([k]) => k.split(':'));
      skipped += await buildAll(oldest);
    }
    // Everything else the site had goes out as it was.
    let kept = 0;
    for (const [k, v] of store) {
      if (built.has(k) || built.size >= room) continue;
      const file = fileFor(v.path);
      if (!file) continue;
      let html;
      try {
        html = readFileSync(storeFile(v.path), 'utf8');
      } catch {
        continue;
      }
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, html);
      built.set(k, v.path);
      linkedEntities(html, links);
      kept++;
    }
    // SEO 2026-11 — then new pages: the ones built pages link to most (an
    // artist's other albums, an album's other songs), so links lead somewhere.
    const fresh = nextPages(links, built, tried, room - built.size, MAX_LINKED);
    console.log(`entity pages: ${kept} kept as they were; ${fresh.length} new ones that built pages link to`);
    if (!skipped) skipped = await buildAll(fresh);
    urls.push(...built.values());
    console.log(
      `entity pages: ${urls.length} in this build (${rendered} rendered, ${kept} kept, ${failed} unavailable${skipped > 0 ? `, ${skipped} left for the time budget` : ''}) in ${Math.round((Date.now() - started) / 1000)} s`,
    );
    finishPages(built, info);
    saveStore(store);
  } catch (e) {
    console.warn('entity pages: stopped early —', e && e.message);
  } finally {
    writeSitemap(urls.sort());
    await vite.close();
  }
  return enabled ? { written: urls.length, live: liveCount } : null;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (result) => {
      // main() answers undefined/null when entity pages are off (local builds).
      if (result && typeof result.written === 'number') {
        const min = minimumPages(result.live);
        if (tooFewPages(result.written, true, min)) {
          console.error(
            `entity pages: only ${result.written} in this build (minimum ${min}; the live site lists ${result.live ?? 'an unknown number'}) — failing the build so the live site keeps its pages. Check the catalogue sources in MIRRORS; ENTITY_MIN_PAGES=0 overrides.`,
          );
          process.exit(1);
        }
      }
      process.exit(0);
    },
    (e) => {
      console.warn('entity pages: skipped —', e && e.message);
      try {
        writeSitemap([]);
      } catch {
        /* dist missing */
      }
      // On the static host a build with no entity pages must not go live.
      process.exit(enabled && MIN_PAGES > 0 ? 1 : 0);
    },
  );
}
