/**
 * Live sitemap INDEX — the "in-built" auto-refresh mechanism.
 *
 * Two families of children:
 *   1. Legacy live-search maps (sitemap-*.xml) — a few thousand always-fresh
 *      URLs rebuilt on request from live catalog search. These predate the
 *      "no new dotted function filenames" ops rule and keep working.
 *   2. Corpus maps (/sitemaps/<type>-<n>.xml, 10k URLs each) — paginated over
 *      the ever-growing vinax_seo_urls corpus fed by the seo-crawl walker.
 *      The page count is computed from live row counts, so as the walker
 *      discovers the catalog the index grows without bound (4.15.0).
 *
 * Every child is generated ON-REQUEST and edge-cached (30 min); no scheduler,
 * no build step. If the database/the corpus table is missing, the index degrades
 * to exactly the legacy behavior — never fewer URLs than before.
 */
import { dbCount, type DbEnv } from './_lib/db';
import { SEO_PAGE_SIZE, SEO_TYPES } from './_lib/seo';

const ORIGIN = 'https://www.sirimillavinay.online';
const MAPS = [
  'sitemap-static.xml',
  'sitemap-hubs.xml',
  'sitemap-songs.xml',
  'sitemap-albums.xml',
  'sitemap-movies.xml',
  'sitemap-artists.xml',
];

export const onRequestGet = async (context: { env: DbEnv }): Promise<Response> => {
  const today = new Date().toISOString().slice(0, 10);
  const children: string[] = MAPS.map((m) => `${ORIGIN}/${m}`);

  // Corpus maps — one entry per 10k-URL page per entity type. Counts are four
  // cheap HEAD requests; any failure just means "no corpus maps this render".
  const counts = await Promise.all(
    Object.entries(SEO_TYPES).map(async ([plural, type]) => ({
      plural,
      count: (await dbCount(context.env, 'vinax_seo_urls', `type=eq.${type}`)) ?? 0,
    })),
  );
  for (const { plural, count } of counts) {
    const pages = Math.min(Math.ceil(count / SEO_PAGE_SIZE), 9999);
    for (let n = 1; n <= pages; n++) children.push(`${ORIGIN}/sitemaps/${plural}-${n}.xml`);
  }

  const body =
    '<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
    children.map((loc) => `<sitemap><loc>${loc}</loc><lastmod>${today}</lastmod></sitemap>`).join('') +
    '</sitemapindex>';
  return new Response(body, {
    headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=1800, s-maxage=1800' },
  });
};
