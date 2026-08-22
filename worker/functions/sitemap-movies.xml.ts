/* eslint-disable @typescript-eslint/no-explicit-any */
// Film-soundtrack sitemap: fresh + hit movie albums across major languages,
// so "<movie name> songs" searches land on VinaX album pages. Edge-cached.
// Pruned 2026-07 (DQA-10): saavn.dev DNS is dead and the b4a.run mirror 404s
// these endpoints — both only added timeout latency to sitemap builds.
import type { SupabaseEnv } from './_lib/supabase';
import { artistRows, harvestSoon, seoRow } from './_lib/seo';

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

async function results(query: string, limit = 30): Promise<any[]> {
  return fetchFirst(`search/albums?query=${encodeURIComponent(query)}&limit=${limit}`);
}

export const onRequestGet = async (context: {
  env: SupabaseEnv;
  waitUntil?: (p: Promise<unknown>) => void;
}): Promise<Response> => {
  const urls = new Set<string>();
  const harvested: any[] = [];
  const tasks: Promise<any[]>[] = [];
  for (const l of LANGS) {
    tasks.push(results(`${l} movie songs ${YEAR}`));
    tasks.push(results(`new ${l} film songs`));
    tasks.push(results(`${l} blockbuster hit songs`));
  }
  const all = await Promise.allSettled(tasks);
  for (const res of all) {
    if (res.status !== 'fulfilled') continue;
    for (const a of res.value) {
      if (!a?.id || !a?.name) continue;
      // Audit finding M-SRV-7: sanitize the id before it enters the XML.
      const safeId = String(a.id).replace(/[^\w-]/g, '');
      if (!safeId) continue;
      urls.add(`${ORIGIN}/album/${slugify(a.name)}-${safeId}`);  // no trailing slash: must match the page's canonical (4.16.3)
      harvested.push(a);
    }
  }
  // Movie albums join the SEO corpus + walker frontier too.
  harvestSoon(
    context.env,
    harvested.flatMap((a) => [seoRow('album', a?.id, a?.name, a?.language), ...artistRows(a?.artists)]),
    context.waitUntil,
  );
  const today = new Date().toISOString().slice(0, 10);
  const body =
    '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
    [...urls]
      .slice(0, 2500)
      .map((u) => `<url><loc>${u}</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>0.7</priority></url>`)
      .join('') +
    '</urlset>';
  return new Response(body, {
    headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=1800, s-maxage=1800' },
  });
};
