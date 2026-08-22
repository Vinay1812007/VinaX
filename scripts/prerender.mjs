// Build-time prerender: writes per-route static HTML for high-value static
// routes so crawlers see real content + unique head (title/description/canonical/OG)
// without running JS. Fully defensive — never fails the build.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const DIST = 'dist';
const ORIGIN = 'https://www.sirimillavinay.online';
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const ROUTES = [
  { p: '/', t: 'VinaX — Free Music Streaming for India', d: 'VinaX is a free, no-login music streaming app for India — Telugu, Hindi, Tamil and nine more languages, with smart recommendations, live charts, an AI DJ and synced lyrics. Private by design, tuned to you.', h1: 'VinaX — Free Music Streaming for India' },
  { p: '/discover', t: 'Discover', d: 'Fresh picks, trending songs and ready-made mixes across languages and moods.', h1: 'Discover new music' },
  { p: '/charts', t: 'Top Charts', d: 'The most popular songs right now, by language — updated daily.', h1: 'Top Charts', ld: { '@context': 'https://schema.org', '@type': 'CollectionPage', '@id': 'https://www.sirimillavinay.online/charts#page', name: 'Top Charts', url: 'https://www.sirimillavinay.online/charts', isPartOf: { '@id': 'https://www.sirimillavinay.online/#website' } } },
  { p: '/top-songs', t: 'Top Songs — Most Popular Right Now', d: 'The most popular songs on VinaX right now — Telugu, Hindi, Tamil and nine more languages. Stream the top hits free, no login, updated continuously.', h1: 'Top Songs', ld: { '@context': 'https://schema.org', '@type': 'CollectionPage', '@id': 'https://www.sirimillavinay.online/top-songs#page', name: 'Top Songs on VinaX', url: 'https://www.sirimillavinay.online/top-songs', isPartOf: { '@id': 'https://www.sirimillavinay.online/#website' } } },
  { p: '/trending', t: 'Trending Songs This Week', d: 'What India is playing this week on VinaX — trending Telugu, Hindi, Tamil, Punjabi and more. Free streaming, no login, refreshed continuously.', h1: 'Trending Songs', ld: { '@context': 'https://schema.org', '@type': 'CollectionPage', '@id': 'https://www.sirimillavinay.online/trending#page', name: 'Trending Songs on VinaX', url: 'https://www.sirimillavinay.online/trending', isPartOf: { '@id': 'https://www.sirimillavinay.online/#website' } } },
  { p: '/most-searched', t: 'Most Searched Songs & Queries', d: 'The songs and searches people look for most on VinaX — across Telugu, Hindi, Tamil and more. Discover what everyone is hunting for. Free, no login.', h1: 'Most Searched Songs', ld: { '@context': 'https://schema.org', '@type': 'CollectionPage', '@id': 'https://www.sirimillavinay.online/most-searched#page', name: 'Most Searched Songs on VinaX', url: 'https://www.sirimillavinay.online/most-searched', isPartOf: { '@id': 'https://www.sirimillavinay.online/#website' } } },
  { p: '/explore', t: 'Explore', d: 'Browse by mood, genre, language, region and film soundtracks.', h1: 'Explore VinaX' },
  { p: '/moods', t: 'Moods', d: 'Music for every moment — romance, workout, chill, party, focus and more.', h1: 'Music for every mood', ld: { '@context': 'https://schema.org', '@type': 'CollectionPage', '@id': 'https://www.sirimillavinay.online/moods#page', name: 'Music by Mood', url: 'https://www.sirimillavinay.online/moods', isPartOf: { '@id': 'https://www.sirimillavinay.online/#website' } } },
  { p: '/movies', t: 'Movie Music', d: 'Film soundtracks and hit songs from the movies.', h1: 'Movie soundtracks', ld: { '@context': 'https://schema.org', '@type': 'CollectionPage', '@id': 'https://www.sirimillavinay.online/movies#page', name: 'Movie Soundtracks', url: 'https://www.sirimillavinay.online/movies', isPartOf: { '@id': 'https://www.sirimillavinay.online/#website' } } },
  { p: '/regions', t: 'Regions', d: 'Music tuned to your region and language.', h1: 'Music by region' },
  { p: '/languages', t: 'Languages', d: 'Pin the languages you listen to — Telugu, Hindi, Tamil, English and more.', h1: 'Browse by language', ld: { '@context': 'https://schema.org', '@type': 'CollectionPage', '@id': 'https://www.sirimillavinay.online/languages#page', name: 'Music by Language', url: 'https://www.sirimillavinay.online/languages', isPartOf: { '@id': 'https://www.sirimillavinay.online/#website' } } },
  { p: '/made-for-you', t: 'Made For You', d: 'Personal mixes built from your listening — private and on-device.', h1: 'Made for you' },
  { p: '/about', t: 'About', d: 'VinaX is a free, no-login music player. Private by design, tuned to you.', h1: 'About VinaX', ld: { '@context': 'https://schema.org', '@type': 'AboutPage', '@id': 'https://www.sirimillavinay.online/about#page', name: 'About VinaX', url: 'https://www.sirimillavinay.online/about', mainEntity: { '@id': 'https://www.sirimillavinay.online/#org' } } },
  { p: '/help', t: 'Help & Feedback', d: 'FAQs, how-tos, and how to report a problem.', h1: 'Help & Feedback' },
  { p: '/VinaXAI', t: 'VinaX AI — ask anything', d: 'Chat with VinaX AI — ask anything, search the live web, and get clean answers with code, tables and images. Free, private, no login.', h1: 'VinaX AI' },
  { p: '/download', t: 'Get the App', d: 'Install VinaX on Android for background playback and offline downloads.', h1: 'Get VinaX for Android' },
  { p: '/privacy', t: 'Privacy', d: 'No accounts. Your data stays on your device. Private by design.', h1: 'Privacy' },
  { p: '/terms', t: 'Terms of Use', d: 'Content is sourced from third parties; no DRM circumvention. Plain-language terms.', h1: 'Terms of Use' },
  { p: '/contact', t: 'Contact & Takedowns', d: 'Contact VinaX for support, bug reports, or rights / takedown requests.', h1: 'Contact & Takedowns' },
];

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const HUB_LANGS = ['hindi', 'telugu', 'tamil', 'english', 'punjabi', 'kannada', 'malayalam', 'bengali', 'marathi', 'bhojpuri', 'gujarati', 'urdu'];
for (const l of HUB_LANGS) {
  ROUTES.push({
    p: `/${l}-songs`,
    t: `${cap(l)} Songs — Latest Hits & Trending`,
    d: `Stream the latest ${cap(l)} songs free on VinaX — trending hits, new releases and evergreen favourites. No login, private by design.`,
    h1: `${cap(l)} Songs`,
    ld: {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      '@id': `${ORIGIN}/${l}-songs#page`,
      name: `${cap(l)} Songs`,
      url: `${ORIGIN}/${l}-songs`,
      isPartOf: { '@id': `${ORIGIN}/#website` },
    },
  });
}

const NAV_LINKS = [
  ['/', 'Home'], ['/discover', 'Discover'], ['/charts', 'Charts'], ['/top-songs', 'Top Songs'],
  ['/trending', 'Trending'], ['/most-searched', 'Most Searched'], ['/explore', 'Explore'],
  ['/moods', 'Moods'], ['/movies', 'Movies'], ['/languages', 'Languages'], ['/telugu-songs', 'Telugu Songs'], ['/hindi-songs', 'Hindi Songs'], ['/tamil-songs', 'Tamil Songs'],
  ['/made-for-you', 'Made For You'], ['/about', 'About'], ['/privacy', 'Privacy'],
  ['/terms', 'Terms'], ['/contact', 'Contact'],
];
const NAV = `<nav aria-label="Browse VinaX">${NAV_LINKS.map(([h, l]) => `<a href="${h}">${esc(l)}</a>`).join(' ')}</nav>`;

// Per-route try/catch so a single bad route doesn't skip the other 27 — and
// the process exits non-zero if any route failed OR if the base template
// itself was unreadable, so a silent SEO outage can't ship (audit finding
// L13; the README advertises "prerender 28 routes").
let base;
try {
  base = readFileSync(join(DIST, 'index.html'), 'utf8');
} catch (e) {
  console.error('prerender: cannot read dist/index.html:', e && e.message);
  process.exit(1);
}

/**
 * Same JSON-LD script-escape as the edge renderer — a route's payload could
 * grow to contain user-supplied strings (album titles etc.) at some point,
 * and there is no cost to being defensive today.
 */
const jsonForScript = (value) =>
  JSON.stringify(value ?? null)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/[\u2028\u2029]/g, (c) => c === '\u2028' ? '\\u2028' : '\\u2029');

let ok = 0;
const failures = [];
for (const r of ROUTES) {
  try {
    const head =
      `<link rel="canonical" href="${ORIGIN}${r.p}"/>` +
      `<meta property="og:title" content="${esc(r.t)} · VinaX"/>` +
      `<meta property="og:description" content="${esc(r.d)}"/>` +
      `<meta property="og:url" content="${ORIGIN}${r.p}"/>` +
      (r.ld ? `<script type="application/ld+json">${jsonForScript(r.ld)}</script>` : '') +
      `</head>`;
    const content =
      `<div id="seo-content"><h1>${esc(r.h1)}</h1><p>${esc(r.d)}</p>${NAV}</div>`;
    const html = base
      .replace(/<title>[^<]*<\/title>/, `<title>${esc(r.t)} · VinaX</title>`)
      .replace(/(<meta name="description" content=")[^"]*(")/, `$1${esc(r.d)}$2`)
      .replace('</head>', head)
      .replace('<div id="seo-slot"></div>', content);
    const out = r.p === '/' ? join(DIST, 'index.html') : join(DIST, r.p.replace(/^\//, ''), 'index.html');
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, html);
    ok++;
  } catch (e) {
    failures.push(`${r.p}: ${e && e.message}`);
  }
}

console.log(`prerender: wrote ${ok} routes${failures.length ? ` (${failures.length} failed)` : ''}`);
if (failures.length) {
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
process.exit(0);
