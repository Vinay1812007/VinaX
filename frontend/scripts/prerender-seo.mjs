// Build-time SEO files, written as static files the host serves at no Worker
// cost (V2 1.0):
//
//   dist/<lang>-<mood>-songs.html   the 72 mood × language hubs (renderHub)
//   dist/sitemap.xml                the sitemap index
//   dist/sitemap-static.xml         the prerendered app routes
//   dist/sitemap-hubs.xml           the hubs
//
// from the Worker's own renderer and sitemap handlers, so the words and the
// URLs are the ones the edge used to answer with. A flat .html file, not a
// folder: the host answers /telugu-sad-songs from telugu-sad-songs.html with
// a 200, which matches the canonical (no trailing slash).
//
// VinaX has no music catalogue any more, so nothing here touches the network:
// the hubs carry text and links only, and there are no song, album or artist
// pages to build. It never fails the build.
/* global Request, Response */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const DIST = process.env.PRERENDER_DIST || 'dist';
const ORIGIN = 'https://www.vinaxmusic.online';
const SHELL_CACHE = 'node_modules/.cache/vinax/shell.html';
const RENDER_TS = resolve(dirname(fileURLToPath(import.meta.url)), '../../backend/worker/functions/_lib/render.ts');
const WORKER_FN = resolve(dirname(fileURLToPath(import.meta.url)), '../../backend/worker/functions');
const LANGS = ['telugu', 'hindi', 'tamil', 'punjabi', 'kannada', 'malayalam', 'bengali', 'marathi', 'bhojpuri', 'gujarati', 'urdu', 'english'];
/** The mood × language hubs, as functions/sitemap-hubs.xml.ts lists them. */
export const HUB_MOODS = ['romantic', 'sad', 'party', 'devotional', 'melody', 'workout'];
export const HUB_PATHS = LANGS.flatMap((l) => HUB_MOODS.map((m) => `/${l}-${m}-songs`));
/** The sitemaps written as static files, and the Worker handler each comes from. */
export const STATIC_SITEMAPS = [
  ['sitemap.xml', 'sitemap.xml.ts'],
  ['sitemap-static.xml', 'sitemap-static.xml.ts'],
  ['sitemap-hubs.xml', 'sitemap-hubs.xml.ts'],
];

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

/** Render the 72 hubs into dist. */
async function writeHubs(render, shell) {
  const env = { ASSETS: { fetch: async () => new Response(shell, { headers: { 'content-type': 'text/html' } }) } };
  let written = 0;
  for (const path of HUB_PATHS) {
    const hub = render.matchHub(path);
    const file = hubFileFor(path);
    if (!hub || !file) continue;
    try {
      const res = await render.renderHub(hub.lang, hub.mood, new Request(`${ORIGIN}${path}`), env);
      const html = await res.text();
      if (!res.ok || !html.includes('seo-content')) continue;
      writeFileSync(file, html);
      written++;
    } catch {
      /* this hub keeps the app shell */
    }
  }
  console.log(`hub pages: wrote ${written} of ${HUB_PATHS.length}`);
}

async function main() {
  let shell;
  try {
    shell = readFileSync(SHELL_CACHE, 'utf8');
  } catch {
    console.warn('seo pages: no shell (run scripts/prerender.mjs first) — skipped');
    return;
  }
  const vite = await createServer({ logLevel: 'error', server: { middlewareMode: true }, appType: 'custom' });
  try {
    await writeStaticSitemaps(vite);
    await writeHubs(await vite.ssrLoadModule(RENDER_TS), shell);
  } catch (e) {
    console.warn('seo pages: stopped early —', e && e.message);
  } finally {
    await vite.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    () => process.exit(0),
    (e) => {
      console.warn('seo pages: skipped —', e && e.message);
      process.exit(0);
    },
  );
}
