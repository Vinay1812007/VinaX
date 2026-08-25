/* eslint-disable @typescript-eslint/no-explicit-any */
// Dynamic SONG sitemap — sourced from live search across major languages, so it
// always reflects the current catalog. Generated on-request, then held at the
// edge for 30 min (cache-control max-age=1800, s-maxage=1800): no scheduler, no
// build step — every crawl is ≤30 min fresh and the first hit after each TTL
// rebuilds it from live data. Defensive; referenced from the sitemap index.
// Pruned 2026-07 (DQA-10): saavn.dev DNS is dead and the b4a.run mirror 404s
// these endpoints — both only added timeout latency to sitemap builds.
import type { DbEnv } from './_lib/db';
import { harvestSoon, songRowsDeep } from './_lib/seo';

const BASES = [
  'https://www.sirimillavinay.online/api/cat',
  'https://saavn.sumit.co/api',
  'https://nepotuneapi.vercel.app/api',
];
// Try each catalog mirror until one answers with results (with a per-mirror
// timeout). Without this, a single degraded provider (e.g. saavn.dev 503)
// produced an EMPTY sitemap and Google had no song/artist/album pages to index.
async function fetchFirst(suffix: string): Promise<any[]> {
  for (const base of BASES) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      const r = await fetch(`${base}/${suffix}`, { headers: { accept: 'application/json' }, signal: ctrl.signal });
      clearTimeout(timer);
      if (!r.ok) continue;
      const j: any = await r.json();
      const arr = j?.data?.results ?? [];
      if (arr.length) return arr;
    } catch {
      /* dead / slow provider — try the next one */
    }
  }
  return [];
}
const ORIGIN = 'https://www.sirimillavinay.online';
const YEAR = new Date().getFullYear();
const slugify = (t: unknown): string =>
  String(t ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/&[a-z]+;|&#x?[0-9a-f]+;/gi, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'x';
const LANGS = ['hindi', 'telugu', 'tamil', 'english', 'punjabi', 'kannada', 'malayalam', 'bengali', 'marathi', 'bhojpuri', 'gujarati', 'urdu'];
function xml(urls: string[]): string {
  const today = new Date().toISOString().slice(0, 10);
  return (
    '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
    urls.map((u) => `<url><loc>${u}</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>0.6</priority></url>`).join('') +
    '</urlset>'
  );
}
function respond(body: string): Response {
  return new Response(body, {
    headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=1800, s-maxage=1800' },
  });
}
async function results(path: string, query: string, limit = 25): Promise<any[]> {
  return fetchFirst(`${path}?query=${encodeURIComponent(query)}&limit=${limit}`);
}

export const onRequestGet = async (context: {
  env: DbEnv;
  waitUntil?: (p: Promise<unknown>) => void;
}): Promise<Response> => {
  const urls = new Set<string>();
  const harvested: any[] = [];
  const tasks: Promise<any[]>[] = [];
  // Three complementary seeds per language widen catalog breadth (top / current
  // hits / all-time popular) while staying well under the 50k-URL per-file cap.
  for (const l of LANGS) {
    tasks.push(results('search/songs', `top ${l} songs`, 30));
    tasks.push(results('search/songs', `${l} hit songs ${YEAR}`, 30));
    tasks.push(results('search/songs', `popular ${l} songs`, 30));
    // Mood-intent seeds double catalog breadth (~1k → ~2k+ song URLs) and
    // feed exactly the queries the mood x language hub pages target.
    tasks.push(results('search/songs', `${l} romantic songs`, 30));
    tasks.push(results('search/songs', `${l} sad songs`, 30));
    tasks.push(results('search/songs', `${l} melody songs`, 30));
  }
  const all = await Promise.allSettled(tasks);
  for (const res of all) {
    if (res.status !== 'fulfilled') continue;
    for (const s of res.value) {
      if (!s?.id || !s?.name) continue;
      // Audit finding M-SRV-7: catalog ids get inlined into the sitemap XML
      // without any escaping, so a hostile upstream that ever slipped `"><foo`
      // into an id would break the XML wellformedness (and, worse, could
      // inject <url> elements Google would then follow). Strict allow-list.
      const safeId = String(s.id).replace(/[^\w-]/g, '');
      if (!safeId) continue;
      urls.add(`${ORIGIN}/song/${slugify(s.name)}-${safeId}`);  // no trailing slash: must match the page's canonical (4.16.3)
      harvested.push(s);
    }
  }
  // Every rebuild feeds the persistent SEO corpus (songs + their albums +
  // artists) — fire-and-forget, the sitemap response never waits on it.
  harvestSoon(context.env, harvested.flatMap(songRowsDeep), context.waitUntil);
  // Hard cap at the sitemap 50k-URL limit (defensive — the seed set stays far
  // below it, but never emit an oversized file if the catalog ever balloons).
  return respond(xml([...urls].slice(0, 50000)));
};
