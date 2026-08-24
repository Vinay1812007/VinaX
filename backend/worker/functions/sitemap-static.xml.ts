/** Static + hub routes. Mirrors the prerendered route set. */
const ORIGIN = 'https://www.sirimillavinay.online';

const HUB_LANGUAGES = ['hindi', 'telugu', 'tamil', 'english', 'punjabi', 'kannada', 'malayalam', 'bengali', 'marathi', 'bhojpuri', 'gujarati', 'urdu'];

const ROUTES: Array<[path: string, changefreq: string, priority: string]> = [
  ['/', 'daily', '1.0'],
  ['/discover', 'daily', '0.8'],
  ['/charts', 'daily', '0.8'],
  ['/top-songs', 'daily', '0.9'],
  ['/trending', 'daily', '0.9'],
  ['/most-searched', 'daily', '0.8'],
  ['/movies', 'daily', '0.8'],
  ['/explore', 'weekly', '0.7'],
  ['/moods', 'weekly', '0.7'],
  ['/languages', 'weekly', '0.6'],
  ['/regions', 'weekly', '0.6'],
  ['/made-for-you', 'daily', '0.8'],
  ['/VinaXAI', 'weekly', '0.8'],
  ['/download', 'weekly', '0.9'],
  ['/about', 'monthly', '0.4'],
  ['/help', 'monthly', '0.4'],
  ['/privacy', 'yearly', '0.3'],
  ['/terms', 'yearly', '0.3'],
  ['/contact', 'monthly', '0.3'],
  ...HUB_LANGUAGES.map((l): [string, string, string] => [`/${l}-songs`, 'daily', '0.8']),
];

export const onRequestGet = async (): Promise<Response> => {
  const today = new Date().toISOString().slice(0, 10);
  const body =
    '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
    ROUTES.map(
      ([p, c, pr]) =>
        `<url><loc>${ORIGIN}${p === '/' ? '' : p}/</loc><lastmod>${today}</lastmod><changefreq>${c}</changefreq><priority>${pr}</priority></url>`,
    ).join('') +
    '</urlset>';
  return new Response(body, {
    // 30-min freshness WITHOUT a scheduler: generated on-request, then held at
    // the edge for 1800 s (max-age + s-maxage). Every crawler hit is at most
    // 30 min stale, and a fresh copy is rebuilt on the next request after TTL.
    headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=1800, s-maxage=1800' },
  });
};
