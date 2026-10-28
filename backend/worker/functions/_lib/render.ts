/**
 * Edge/build render for the mood × language hub pages (/<lang>-<mood>-songs):
 * real title, description, JSON-LD and a crawlable content block injected
 * into the SPA shell. VinaX has no music catalogue any more, so hubs carry
 * text and links only — no song lists — and there are no song, album,
 * artist or playlist pages to render.
 */
const ORIGIN = 'https://www.vinaxmusic.online';

interface Assets {
  ASSETS: { fetch: (req: Request | string | URL) => Promise<Response> };
}

type RenderEnv = Assets;

const esc = (s: unknown): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * Serialize a value for embedding inside a `<script type="application/ld+json">`
 * block. Plain `JSON.stringify` leaves `<`, `>`, `&`, and the Unicode line/para
 * separators intact — an upstream album/song whose name contains `</script>`
 * would then break out of the script context. We escape those characters as
 * `\uXXXX` inside string literals: still valid JSON, safe HTML.
 */
const jsonForScript = (value: unknown): string =>
  JSON.stringify(value ?? null)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/[\u2028\u2029]/g, (c) => c === '\u2028' ? '\\u2028' : '\\u2029');

const LANG_TAG: Record<string, string> = {
  hindi: 'hi', telugu: 'te', tamil: 'ta', english: 'en', punjabi: 'pa', kannada: 'kn',
  malayalam: 'ml', bengali: 'bn', marathi: 'mr', bhojpuri: 'bho', gujarati: 'gu', urdu: 'ur',
};
const capWord = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

interface Crumb {
  name: string;
  item?: string;
}

function breadcrumbLd(crumbs: Crumb[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      ...(c.item ? { item: c.item } : {}),
    })),
  };
}


// Mood x language hubs — KEEP IN SYNC with src/constants/hubs.ts and
// src/constants/languages.ts HUB_LANGUAGES (functions cannot import src/).
const HUB_LANGS = Object.keys(LANG_TAG);
const HUB_MOODS: Record<string, { label: string; blurb: string }> = {
  romantic: { label: 'Romantic', blurb: 'love songs and melodies for every heartbeat' },
  sad: { label: 'Sad', blurb: 'heartbreak and healing, one song at a time' },
  party: { label: 'Party', blurb: 'dance-floor anthems and beat drops' },
  devotional: { label: 'Devotional', blurb: 'bhajans and devotional classics' },
  melody: { label: 'Melody', blurb: 'timeless melodies, soft and soulful' },
  workout: { label: 'Workout', blurb: 'high-energy tracks that keep you moving' },
};

/** /<lang>-<mood>-songs → {lang, mood} when it names a real hub, else null. */
export function matchHub(pathname: string): { lang: string; mood: string } | null {
  const m = /^\/([a-z]+)-([a-z]+)-songs\/?$/.exec(pathname);
  if (!m) return null;
  if (!HUB_LANGS.includes(m[1]) || !HUB_MOODS[m[2]]) return null;
  return { lang: m[1], mood: m[2] };
}


/**
 * Swap the crawlable content block into the shell (4.17.6 CRITICAL FIX).
 * The build prerenders dist/index.html as the HOME page, which CONSUMES the
 * `<div id="seo-slot"></div>` placeholder — so the old `.replace(seo-slot)`
 * was a silent no-op and EVERY song/album/artist page shipped the generic
 * home text as its body (Google: thin duplicates, page after page — the
 * indexing killer). Entity content now replaces the existing #seo-content
 * block; the slot form is kept as a fallback for unprerendered shells.
 */
/**
 * Bing Webmaster Tools errors on meta descriptions outside 25–160 chars
 * (BWT URL inspection, 2026-08-17). Templates guarantee the minimum; long
 * catalog names (song/album/artist titles are unbounded) could blow the
 * maximum, so clamp at a word boundary with an ellipsis.
 */
function clampDesc(s: string): string {
  if (s.length <= 160) return s;
  const cut = s.slice(0, 157);
  const at = cut.lastIndexOf(' ');
  return `${cut.slice(0, at > 120 ? at : 157)}…`;
}

function injectContent(shell: string, content: string): string {
  if (shell.includes('<div id="seo-slot"></div>')) {
    return shell.replace('<div id="seo-slot"></div>', content);
  }
  // The prerendered block contains no nested <div>/<main>, so the lazy match
  // ends exactly at its own closing tag. Both tag forms are accepted: shells
  // built ≥4.17.7 bake a <main id="seo-content"> (a11y main landmark), while
  // edge-cached shells from older deploys still carry the <div> form.
  return shell.replace(/<(div|main) id="seo-content">[\s\S]*?<\/\1>/, content);
}

/** Meta for a mood x language hub: unique title/desc/canonical,
 *  CollectionPage JSON-LD and crawlable text. */
export async function renderHub(
  lang: string,
  mood: string,
  request: Request,
  env: RenderEnv,
): Promise<Response> {
  try {
    const shellRes = await env.ASSETS.fetch(new URL('/index.html', request.url).toString());
    const shell = await shellRes.text();
    const hub = HUB_MOODS[mood];
    const label = capWord(lang);
    const path = `/${lang}-${mood}-songs`;
    const title = `${label} ${hub.label} Songs \u2014 Stream Free | VinaX`;
    const desc = clampDesc(`The best ${label} ${hub.label.toLowerCase()} songs \u2014 ${hub.blurb}. Stream free on VinaX, no login, tuned to you.`);
    const jsonld = [
      {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        '@id': `${ORIGIN}${path}#page`,
        name: `${label} ${hub.label} Songs`,
        description: desc,
        url: `${ORIGIN}${path}`,
        isPartOf: { '@id': `${ORIGIN}/#website` },
      },
      breadcrumbLd([
        { name: 'Home', item: `${ORIGIN}/` },
        { name: `${label} Songs`, item: `${ORIGIN}/${lang}-songs` },
        { name: `${label} ${hub.label} Songs` },
      ]),
    ];
    const head =
      `<link rel="canonical" href="${ORIGIN}${path}"/>` +
      `<meta property="og:type" content="website"/>` +
      `<meta property="og:title" content="${esc(title)}"/>` +
      `<meta property="og:description" content="${esc(desc)}"/>` +
      `<meta property="og:url" content="${ORIGIN}${path}"/>` +
      `<script type="application/ld+json">${jsonForScript(jsonld)}</script>` +
      `</head>`;
    const siblings = Object.keys(HUB_MOODS)
      .filter((k) => k !== mood)
      .map((k) => `<a href="/${lang}-${k}-songs">${label} ${HUB_MOODS[k].label} Songs</a>`)
      .join(' \u00b7 ');
    const content =
      `<main id="seo-content"><h1>${esc(label)} ${esc(hub.label)} Songs</h1>` +
      `<p>${esc(label)} ${esc(hub.label.toLowerCase())} songs \u2014 ${esc(hub.blurb)}. Stream free on VinaX: no login, synced lyrics and offline downloads in the Android app.</p>` +
      `<p>The <a href="/${lang}-songs">${esc(label)} songs</a> page has a short guide to ${esc(label)} music, its composers and its singers.</p>` +
      `<p>${siblings}</p>` +
      `<nav aria-label="VinaX"><a href="/${lang}-songs">${esc(label)} Songs</a> <a href="/">Home</a> <a href="/charts">Charts</a> <a href="/discover">Discover</a></nav></main>`;
    const html = shell
      .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
      .replace(/(<meta name="description" content=")[^"]*(")/, `$1${esc(desc)}$2`)
      .replace(/<meta property="og:(type|title|description|image|image:width|image:height)" content="[^"]*"\s*\/?>/g, '')
      // 13.5.0 — the shell is the prerendered HOME page, which carries its own
      // canonical and og:url ("/"). Left in, every hub declared two canonicals
      // with home's first, and Google could file the hub as a copy of home.
      .replace(/<link rel="canonical" href="[^"]*"\s*\/?>/g, '')
      .replace(/<meta property="og:url" content="[^"]*"\s*\/?>/g, '')
      .replace(/<meta name="twitter:(card|image|title|description)" content="[^"]*"\s*\/?>/g, '')
      .replace('</head>', head);
    return new Response(injectContent(html, content), {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=3600, s-maxage=86400' },
    });
  } catch {
    return await env.ASSETS.fetch(request).catch(() => new Response('', { status: 500 }));
  }
}
