/**
 * Sitemap INDEX.
 *
 * 13.6.0 — only maps whose URLs answer with their OWN text:
 *   - sitemap-static.xml — the prerendered pages (Charts, Top songs, language
 *     hubs, About…), generated on request.
 *   - sitemap-hubs.xml — the mood × language hubs this Worker renders.
 *   - entity-pages.xml — a STATIC file the frontend build writes: the song,
 *     album and artist pages it prerendered (frontend/scripts/
 *     prerender-entities.mjs). Served by the static host, not this Worker.
 *
 * Gone from the index: the live-search maps (sitemap-albums/-movies/-artists)
 * and the paginated corpus maps (/sitemaps/<type>-<n>.xml, ~20k URLs). Since
 * the entity routes left the Worker (11.0.2, the scraper), every one of those
 * URLs answers with the app shell — home's text and canonical — so they told
 * Google about tens of thousands of copies of the home page, and each crawl
 * of a child map was a Worker request. The routes still answer for anyone
 * who has them; they are just no longer advertised.
 */
const ORIGIN = 'https://www.vinaxmusic.online';
export const INDEX_MAPS = ['sitemap-static.xml', 'sitemap-hubs.xml', 'entity-pages.xml'];

export const onRequestGet = async (): Promise<Response> => {
  const today = new Date().toISOString().slice(0, 10);
  const body =
    '<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
    INDEX_MAPS.map((m) => `<sitemap><loc>${ORIGIN}/${m}</loc><lastmod>${today}</lastmod></sitemap>`).join('') +
    '</sitemapindex>';
  return new Response(body, {
    headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=1800, s-maxage=1800' },
  });
};
