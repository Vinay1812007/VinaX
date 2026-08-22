/* eslint-disable @typescript-eslint/no-explicit-any */
// Dynamic sitemap — sourced from live search across major languages.
// Defensive + edge-cached for a day; referenced from robots.txt.
// Pruned 2026-07 (DQA-10): saavn.dev DNS is dead and the b4a.run mirror 404s
// these endpoints — both only added timeout latency to sitemap builds.
const BASES = [
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

export const onRequestGet = async (): Promise<Response> => {
  const urls = new Set<string>();
  const tasks: Promise<any[]>[] = [];
  for (const l of LANGS) {
    tasks.push(results('search/artists', `top ${l} singers`, 25));
    tasks.push(results('search/artists', `popular ${l} artists ${YEAR}`, 25));
  }
  const all = await Promise.allSettled(tasks);
  for (const res of all) {
    if (res.status !== 'fulfilled') continue;
    for (const a of res.value) {
      if (!a?.id || !a?.name) continue;
      // Audit finding M-SRV-7: sanitize the id before it enters the XML.
      const safeId = String(a.id).replace(/[^\w-]/g, '');
      if (!safeId) continue;
      urls.add(`${ORIGIN}/artist/${slugify(a.name)}-${safeId}/`);
    }
  }
  return respond(xml([...urls]));
};
