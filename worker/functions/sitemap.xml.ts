/**
 * Live sitemap INDEX — the "in-built" auto-refresh mechanism.
 *
 * Every child map is generated ON-REQUEST from live data and then held at the
 * Cloudflare edge for 30 minutes (cache-control max-age=1800, s-maxage=1800).
 * No GitHub cron, no scheduler, no build step: a crawler always gets a copy
 * that is at most 30 min old, and the first request after each TTL rebuilds it
 * from the live catalog. This index advertises today's lastmod so crawlers
 * re-pull the children, and is itself 30-min edge-cached for the same freshness.
 */
const ORIGIN = 'https://www.sirimillavinay.online';
const MAPS = [
  'sitemap-static.xml',
  'sitemap-songs.xml',
  'sitemap-albums.xml',
  'sitemap-movies.xml',
  'sitemap-artists.xml',
];

export const onRequestGet = async (): Promise<Response> => {
  const today = new Date().toISOString().slice(0, 10);
  const body =
    '<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
    MAPS.map((m) => `<sitemap><loc>${ORIGIN}/${m}</loc><lastmod>${today}</lastmod></sitemap>`).join('') +
    '</sitemapindex>';
  return new Response(body, {
    headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=1800, s-maxage=1800' },
  });
};
