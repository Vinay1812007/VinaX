// Build-time prerender: writes per-route static HTML for high-value static
// routes so crawlers see real content + unique head (title/description/canonical/OG)
// without running JS.
//
// 8.4.0: the body is the page's REAL text, not a one-line summary. The ad
// network's review (and any crawler that does not run JS) saw ~300 characters
// per page — a title, one sentence and the nav — and rejected the site as
// low-value content. Info pages (About, Privacy, Terms, Contact, Copyright)
// are server-rendered from their React components; Home, Help and the
// language hubs render the same shared components/data the app shows
// (HomeAbout, helpContent, LanguageGuide), so crawlers and listeners read
// identical words. Any failure exits non-zero: a silent fallback to thin
// pages is exactly the outage this guards against.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

// PRERENDER_DIST lets a scratch build (vite build --outDir …) be prerendered
// without touching the checkout's dist/.
const DIST = process.env.PRERENDER_DIST || 'dist';
const ORIGIN = 'https://www.sirimillavinay.online';
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const ROUTES = [
  // Home description must sit in Bing's 25–160 char window (BWT flagged the
  // old 205-char version, 2026-08-17). This one is 152. 10.0 — it leads with
  // the free promise, as the app's first-visit welcome does.
  { p: '/', t: 'VinaX — Free Music Streaming for India', d: 'VinaX is free music streaming for India, with no sign-up and no account: Telugu, Hindi, Tamil and 9 more languages, smart mixes, live charts and lyrics.', h1: 'VinaX — Free Music Streaming for India' },
  { p: '/discover', t: 'Discover', d: 'Fresh picks, trending songs and ready-made mixes across languages and moods.', h1: 'Discover new music' },
  { p: '/charts', t: 'Top Charts', d: 'The most popular songs right now, by language — updated daily.', h1: 'Top Charts', ld: { '@context': 'https://schema.org', '@type': 'CollectionPage', '@id': 'https://www.sirimillavinay.online/charts#page', name: 'Top Charts', url: 'https://www.sirimillavinay.online/charts', isPartOf: { '@id': 'https://www.sirimillavinay.online/#website' } } },
  { p: '/top-songs', t: 'Top Songs — Most Popular Right Now', d: 'The most popular songs on VinaX right now — Telugu, Hindi, Tamil and nine more languages. Stream the top hits free, no login, updated continuously.', h1: 'Top Songs', ld: { '@context': 'https://schema.org', '@type': 'CollectionPage', '@id': 'https://www.sirimillavinay.online/top-songs#page', name: 'Top Songs on VinaX', url: 'https://www.sirimillavinay.online/top-songs', isPartOf: { '@id': 'https://www.sirimillavinay.online/#website' } } },
  { p: '/trending', t: 'Popular Songs', d: 'Popular Telugu, Hindi, Tamil, Punjabi and more on VinaX, from the catalogue. Free streaming, no login, refreshed continuously.', h1: 'Popular Songs', ld: { '@context': 'https://schema.org', '@type': 'CollectionPage', '@id': 'https://www.sirimillavinay.online/trending#page', name: 'Popular Songs on VinaX', url: 'https://www.sirimillavinay.online/trending', isPartOf: { '@id': 'https://www.sirimillavinay.online/#website' } } },
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
  { p: '/dmca', t: 'Copyright & Takedowns', d: 'How VinaX credits artists and labels, and how rights holders can have content removed within minutes.', h1: 'Copyright and takedowns' },
];

// Routes whose body is the React page itself (it carries its own <h1>).
const PAGE_COMPONENTS = {
  '/about': 'AboutPage',
  '/privacy': 'PrivacyPage',
  '/terms': 'TermsPage',
  '/contact': 'ContactPage',
  '/dmca': 'DmcaPage',
};

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

// Inline the built stylesheet (4.17.8): the <link rel="stylesheet"> was the
// last render-blocking request on the critical path (~450 ms on PSI's
// throttled mobile — Lighthouse "Render-blocking requests" named exactly this
// file). Baking it into the shell means first paint needs only the HTML
// stream: no extra round trip before the styled #seo-content hero renders.
// Trade-off is ~21 KB gz added to each HTML response, which costs ~100 ms of
// extra HTML download on the same throttled profile — a clear net win. The
// only url() in the bundle is the absolute /fonts/manrope-var.woff2 (already
// preloaded), so inlining cannot break relative resolution. Fully defensive:
// on any surprise, the link tag stays and the page merely loads as before.
try {
  const cssLink = base.match(/<link rel="stylesheet"[^>]*href="\/(assets\/[^"]+\.css)"[^>]*>/);
  if (cssLink) {
    const css = readFileSync(join(DIST, cssLink[1]), 'utf8');
    if (css && !css.includes('</style')) base = base.replace(cssLink[0], `<style>${css}</style>`);
  }
} catch (e) {
  console.error('prerender: css inline skipped:', e && e.message);
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

// Load the shared components through Vite's SSR loader (aliases, TSX and CSS
// imports resolve exactly as in the app build). Only store-free modules are
// loaded here: HelpPage itself pulls in stores and timers, so Help renders
// from its data module instead.
const markup = (el) =>
  renderToStaticMarkup(createElement(MemoryRouter, null, el))
    // React 19 hoists resource hints (<link rel=preload>) into the markup.
    .replace(/<link [^>]*>/g, '');
let bodies;
{
  let vite;
  try {
    vite = await createServer({
      logLevel: 'error',
      appType: 'custom',
      server: { middlewareMode: true, hmr: false, watch: null },
      optimizeDeps: { noDiscovery: true, include: [] },
    });
    const load = (p) => vite.ssrLoadModule(p);
    const pages = {};
    for (const [route, name] of Object.entries(PAGE_COMPONENTS)) {
      pages[route] = markup(createElement((await load(`/src/pages/${name}.tsx`)).default));
    }
    const { HomeAbout } = await load('/src/features/home/HomeAbout.tsx');
    const { LanguageGuide } = await load('/src/features/discover/LanguageGuide.tsx');
    const { GUIDES, FAQ, SHORTCUTS } = await load('/src/features/help/helpContent.ts');
    const { MOOD_HUBS } = await load('/src/constants/hubs.ts');

    const groups = [...new Set(GUIDES.map((g) => g.group))];
    const help =
      `<h2>How to use VinaX</h2>` +
      groups
        .map(
          (group) =>
            `<h3>${esc(group)}</h3>` +
            GUIDES.filter((g) => g.group === group)
              .map((g) => `<p><strong>${esc(g.title)}</strong></p><ol>${g.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`)
              .join(''),
        )
        .join('') +
      `<h2>Frequently asked questions</h2>` +
      FAQ.map((f) => `<h3>${esc(f.q)}</h3><p>${esc(f.a)}</p>`).join('') +
      `<h2>Keyboard and gesture shortcuts</h2><dl>${SHORTCUTS.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` +
      `<p>Something not working? Write to <a href="mailto:hello@sirimillavinay.online">hello@sirimillavinay.online</a> or use the feedback form on this page.</p>`;

    bodies = {
      pages,
      home: markup(createElement(HomeAbout)),
      help,
      hub: (lang, label) =>
        markup(createElement(LanguageGuide, { language: lang, label })) +
        `<h2>${esc(label)} songs by mood</h2><p>${MOOD_HUBS.map((m) => `<a href="/${lang}-${m.slug}-songs">${esc(label)} ${esc(m.label.toLowerCase())} songs</a>`).join(' · ')}</p>`,
    };
  } catch (e) {
    console.error('prerender: component render failed:', e && (e.stack || e.message));
    process.exit(1);
  } finally {
    await vite?.close();
  }
}

/** Home's hero line: the free promise, as the first-visit welcome states it (features/home/HomeWelcome.tsx). */
const HOME_PROMISE =
  '<p><strong>All the music you love. Free.</strong> Free forever, with no sign-up, no account and no subscription: ' +
  'open VinaX and press play. Hindi, Telugu, Tamil, Punjabi and 8 more languages, with synced lyrics, AI Radio, ' +
  'Listen Together rooms, VinaX AI and offline downloads in the Android app.</p>';

/** The crawlable body for one route: the real page text, then the nav. */
function bodyFor(r) {
  if (bodies.pages[r.p]) return bodies.pages[r.p];
  const intro = `<h1>${esc(r.h1)}</h1><p>${esc(r.d)}</p>`;
  // 10.0 — the hero states the promise the app's welcome makes, in the same words.
  if (r.p === '/') return intro + HOME_PROMISE + bodies.home;
  if (r.p === '/help') return intro + bodies.help;
  const hub = /^\/([a-z]+)-songs$/.exec(r.p);
  if (hub) return intro + bodies.hub(hub[1], cap(hub[1]));
  return intro;
}

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
      // <main>: the pre-hydration shell must carry a main landmark of its own
      // (PSI 2026-08: "Document does not have a main landmark" — the audit
      // snapshots the static shell before React mounts <main id="main-content">).
      // React wipes #root children on hydrate, so there is never a duplicate.
      `<main id="seo-content">${bodyFor(r)}${NAV}</main>`;
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
