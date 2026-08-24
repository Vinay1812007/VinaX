/**
 * Mood × language hub sitemap — 72 evergreen category landing pages
 * (/telugu-romantic-songs …). Static list (the hub set only changes with a
 * deploy), same 30-min edge cache as the other maps for a consistent
 * crawler contract. KEEP IN SYNC with src/constants/hubs.ts + languages.
 */
const ORIGIN = 'https://www.sirimillavinay.online';
const LANGS = ['hindi', 'telugu', 'tamil', 'english', 'punjabi', 'kannada', 'malayalam', 'bengali', 'marathi', 'bhojpuri', 'gujarati', 'urdu'];
const MOODS = ['romantic', 'sad', 'party', 'devotional', 'melody', 'workout'];

export const onRequestGet = async (): Promise<Response> => {
  const today = new Date().toISOString().slice(0, 10);
  const urls = LANGS.flatMap((l) => MOODS.map((m) => `${ORIGIN}/${l}-${m}-songs`));
  const body =
    '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
    urls.map((u) => `<url><loc>${u}</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>`).join('') +
    '</urlset>';
  return new Response(body, {
    headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=1800, s-maxage=1800' },
  });
};
