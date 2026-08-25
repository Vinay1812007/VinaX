/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Edge render for dynamic detail pages (/album|artist|playlist|song/:id).
 * Fetches the entity from the upstream music API and injects real title,
 * description, OG image, JSON-LD and a crawlable content block into the SPA
 * shell. Fully defensive: any failure falls back to the plain SPA shell, so a
 * dead provider or timeout never breaks the page. Edge-cached for an hour.
 */
// Mirror ladder — saavn.dev's DNS died (see sitemap-songs.xml.ts, pruned
// 2026-07) and this file still pointed at it alone, so entity pages were
// silently serving the PLAIN shell to every crawler. Same list the sitemaps
// use; first mirror with data wins.
import type { DbEnv } from './db';
import { artistRows, harvestSoon, seoRow, songRowsDeep, type SeoRow } from './seo';

const BASES = ['https://www.sirimillavinay.online/api/cat', 'https://saavn.sumit.co/api', 'https://nepotuneapi.vercel.app/api'];
const ORIGIN = 'https://www.sirimillavinay.online';

interface Assets {
  ASSETS: { fetch: (req: Request | string | URL) => Promise<Response> };
}

type RenderEnv = Assets & DbEnv;
type WaitUntil = ((p: Promise<unknown>) => void) | undefined;

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

function slugify(text: unknown): string {
  return (
    String(text ?? '')
      .toLowerCase()
      .normalize('NFKD')
      // HTML entities from the catalog (&quot; &amp; …) must never become
      // slug words ('-quot-') — strip entity patterns before the collapse.
      .replace(/&[a-z]+;|&#x?[0-9a-f]+;/gi, ' ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'x'
  );
}
const LANG_TAG: Record<string, string> = {
  hindi: 'hi', telugu: 'te', tamil: 'ta', english: 'en', punjabi: 'pa', kannada: 'kn',
  malayalam: 'ml', bengali: 'bn', marathi: 'mr', bhojpuri: 'bho', gujarati: 'gu', urdu: 'ur',
};
const langTag = (l: unknown): string | undefined =>
  typeof l === 'string' ? (LANG_TAG[l.toLowerCase()] ?? l) : undefined;

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

/** Hub crumb when the entity's language has a /<lang>-songs hub page. */
function hubCrumbs(lang: unknown): Crumb[] {
  if (typeof lang !== 'string') return [];
  const l = lang.toLowerCase();
  return LANG_TAG[l] ? [{ name: `${capWord(l)} Songs`, item: `${ORIGIN}/${l}-songs` }] : [];
}

function idOf(param: string): string {
  const parts = String(param).split('-');
  return parts[parts.length - 1] || String(param);
}
function isoDuration(secs: unknown): string | undefined {
  const n = Number(secs);
  if (!n || n <= 0) return undefined;
  return `PT${Math.floor(n / 60)}M${Math.floor(n % 60)}S`;
}

function bestImg(image: any): string {
  if (Array.isArray(image) && image.length) {
    const last: any = image[image.length - 1];
    return (typeof last === 'string' ? last : last?.url || last?.link) || '';
  }
  return typeof image === 'string' ? image : '';
}

function artistNames(a: any): string {
  if (!a) return '';
  if (typeof a === 'string') return a;
  const prim = a.primary ?? a.all ?? a;
  if (Array.isArray(prim)) return prim.map((x: any) => x?.name || x).filter(Boolean).join(', ');
  if (typeof prim?.name === 'string') return prim.name;
  return '';
}

async function fetchJson(suffix: string): Promise<any> {
  for (const base of BASES) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    try {
      const r = await fetch(`${base}/${suffix}`, { signal: ctrl.signal, headers: { accept: 'application/json' } });
      if (r.ok) {
        const j = await r.json();
        if (j?.data) return j;
      }
    } catch {
      /* dead or slow mirror — try the next */
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

interface Meta {
  crumbs?: Crumb[];
  /** Unique crawlable paragraph rendered into the seo-content block. */
  para?: string;
  title: string;
  desc: string;
  image: string;
  h1: string;
  sub: string;
  tracks: Array<{ id: string; title: string; artist: string }>;
  links?: Array<{ href: string; label: string }>;
  jsonld: Record<string, unknown>;
  /** OpenGraph type + music: namespace pairs (the Spotify/JioSaavn share
   *  treatment: og:type music.song with duration/album/musician). */
  ogType: string;
  music?: Array<[string, string]>;
  /** Everything this render learned about the catalog — fed to the SEO URL
   *  corpus fire-and-forget so crawled pages grow the sitemap (4.15.0). */
  harvestRows?: SeoRow[];
}

function songRows(songs: any[]): Array<{ id: string; title: string; artist: string }> {
  return (Array.isArray(songs) ? songs : [])
    .map((s: any) => ({
      id: String(s?.id ?? ''),
      title: String(s?.name ?? s?.title ?? ''),
      artist: artistNames(s?.artists ?? s?.primaryArtists),
    }))
    .filter((s) => s.title);
}

async function buildMeta(type: string, id: string): Promise<Meta | null> {
  if (type === 'album') {
    const j = await fetchJson(`albums?id=${encodeURIComponent(id)}`);
    const d = j?.data;
    if (!d?.name) return null;
    const artist = artistNames(d.artists ?? d.primaryArtists);
    const image = bestImg(d.image);
    const tracks = songRows(d.songs);
    const year = d.year ? ` (${d.year})` : '';
    return {
      harvestRows: [
        seoRow('album', id, d.name, d.language),
        ...artistRows(d.artists),
        ...(Array.isArray(d.songs) ? d.songs : []).flatMap(songRowsDeep),
      ].filter((r): r is SeoRow => !!r),
      crumbs: [{ name: 'Home', item: `${ORIGIN}/` }, ...hubCrumbs(d.language), { name: String(d.name) }],
      title: `${d.name}${year} — Album · VinaX`,
      ogType: 'music.album',
      desc: `Listen to the album ${d.name}${artist ? ` by ${artist}` : ''}${d.year ? `, released ${d.year}` : ''}, on VinaX — free, no login.`,
      image,
      h1: d.name,
      sub: `Album${artist ? ` · ${artist}` : ''}${d.year ? ` · ${d.year}` : ''}`,
      tracks,
      links:
        artist && d.artists?.primary?.[0]?.id
          ? [{ href: `/artist/${slugify(artist)}-${d.artists.primary[0].id}`, label: artist }]
          : undefined,
      jsonld: {
        '@context': 'https://schema.org',
        '@type': 'MusicAlbum',
        '@id': `${ORIGIN}/album/${slugify(d.name)}-${id}#album`,
        name: d.name,
        image: image || undefined,
        datePublished: d.year ? String(d.year) : undefined,
        numTracks: tracks.length || undefined,
        byArtist: artist
          ? {
              '@type': 'MusicGroup',
              name: artist,
              '@id': d.artists?.primary?.[0]?.id
                ? `${ORIGIN}/artist/${slugify(artist)}-${d.artists.primary[0].id}#artist`
                : undefined,
            }
          : undefined,
        url: `${ORIGIN}/album/${slugify(d.name)}-${id}`,
        isPartOf: { '@id': `${ORIGIN}/#website` },
      },
    };
  }
  if (type === 'playlist') {
    const j = await fetchJson(`playlists?id=${encodeURIComponent(id)}`);
    const d = j?.data;
    if (!d?.name) return null;
    const image = bestImg(d.image);
    const tracks = songRows(d.songs);
    return {
      harvestRows: [
        seoRow('playlist', id, d.name),
        ...(Array.isArray(d.songs) ? d.songs : []).flatMap(songRowsDeep),
      ].filter((r): r is SeoRow => !!r),
      crumbs: [{ name: 'Home', item: `${ORIGIN}/` }, { name: String(d.name) }],
      title: `${d.name} — Playlist · VinaX`,
      ogType: 'music.playlist',
      desc: `${d.name} — a playlist with ${tracks.length || 'many'} songs on VinaX. Free, no login.`,
      image,
      h1: d.name,
      sub: `Playlist · ${tracks.length} songs`,
      tracks,
      jsonld: {
        '@context': 'https://schema.org',
        '@type': 'MusicPlaylist',
        '@id': `${ORIGIN}/playlist/${slugify(d.name)}-${id}#playlist`,
        name: d.name,
        image: image || undefined,
        numTracks: tracks.length || undefined,
        url: `${ORIGIN}/playlist/${slugify(d.name)}-${id}`,
        isPartOf: { '@id': `${ORIGIN}/#website` },
      },
    };
  }
  if (type === 'artist') {
    const j = await fetchJson(`artists/${encodeURIComponent(id)}`);
    const d = j?.data ?? j;
    if (!d?.name) return null;
    const image = bestImg(d.image);
    return {
      harvestRows: [
        seoRow('artist', id, d.name),
        ...(Array.isArray(d.topSongs) ? d.topSongs : []).flatMap(songRowsDeep),
        ...(Array.isArray(d.topAlbums) ? d.topAlbums : [])
          .map((al: any) => seoRow('album', al?.id, al?.name, al?.language)),
      ].filter((r): r is SeoRow => !!r),
      crumbs: [{ name: 'Home', item: `${ORIGIN}/` }, { name: String(d.name) }],
      title: `${d.name} — Songs & Albums · VinaX`,
      ogType: 'profile',
      desc: `Top songs, albums and tracks by ${d.name} on VinaX — free, no login.`,
      image,
      h1: d.name,
      sub: 'Artist',
      tracks: songRows(d.topSongs),
      jsonld: {
        '@context': 'https://schema.org',
        '@type': 'MusicGroup',
        '@id': `${ORIGIN}/artist/${slugify(d.name)}-${id}#artist`,
        name: d.name,
        image: image || undefined,
        url: `${ORIGIN}/artist/${slugify(d.name)}-${id}`,
        isPartOf: { '@id': `${ORIGIN}/#website` },
      },
    };
  }
  // song
  const j = await fetchJson(`songs/${encodeURIComponent(id)}`);
  const d = Array.isArray(j?.data) ? j.data[0] : j?.data;
  if (!d?.name) return null;
  const artist = artistNames(d.artists ?? d.primaryArtists);
  const artistId: string | undefined =
    d.artists?.primary?.[0]?.id ??
    (typeof d.primaryArtistsId === 'string' ? d.primaryArtistsId.split(',')[0] : undefined);
  const album = d.album?.name;
  const albumId: string | undefined = d.album?.id;
  const image = bestImg(d.image);
  const year = d.year ? String(d.year) : undefined;
  const lang = typeof d.language === 'string' ? d.language : undefined;
  const links: Array<{ href: string; label: string }> = [];
  if (artist && artistId) links.push({ href: `/artist/${slugify(artist)}-${artistId}`, label: artist });
  if (album && albumId) links.push({ href: `/album/${slugify(album)}-${albumId}`, label: album });
  return {
    harvestRows: songRowsDeep(d),
    crumbs: [
      { name: 'Home', item: `${ORIGIN}/` },
      ...hubCrumbs(lang),
      ...(album && albumId ? [{ name: String(album), item: `${ORIGIN}/album/${slugify(album)}-${albumId}` }] : []),
      { name: String(d.name) },
    ],
    title: `${d.name}${artist ? ` — ${artist}` : ''}${lang ? ` · ${capWord(lang)} Song` : ''} | VinaX`,
    ogType: 'music.song',
    music: [
      ...(d.duration ? [['music:duration', String(Math.floor(Number(d.duration)))] as [string, string]] : []),
      ...(artist ? [['music:musician', artist] as [string, string]] : []),
      ...(album ? [['music:album', album] as [string, string]] : []),
      ...(year ? [['music:release_date', year] as [string, string]] : []),
    ],
    desc: `Listen to ${d.name}${artist ? ` by ${artist}` : ''}${album ? ` from ${album}` : ''}${year ? ` (${year})` : ''}${lang ? ` — ${capWord(lang)} song` : ''} on VinaX — free, no login.`,
    image,
    h1: d.name,
    sub: `Song${artist ? ` · ${artist}` : ''}${album ? ` · ${album}` : ''}${lang ? ` · ${lang}` : ''}${year ? ` · ${year}` : ''}`,
    para: `\u201c${d.name}\u201d is a${lang ? ` ${capWord(lang)}` : ''} song${artist ? ` by ${artist}` : ''}${album ? ` from ${album}` : ''}${year ? `, released in ${year}` : ''}. Stream it online free on VinaX \u2014 instant play, synced lyrics, offline downloads, no login and no ads.`,
    tracks: [],
    links,
    jsonld: {
      '@context': 'https://schema.org',
      '@type': 'MusicRecording',
      '@id': `${ORIGIN}/song/${slugify(d.name)}-${id}#recording`,
      name: d.name,
      image: image || undefined,
      duration: isoDuration(d.duration),
      datePublished: year,
      inLanguage: langTag(lang),
      genre: typeof d.genre === 'string' ? d.genre : undefined,
      byArtist: artist
        ? {
            '@type': 'MusicGroup',
            name: artist,
            '@id': artistId ? `${ORIGIN}/artist/${slugify(artist)}-${artistId}#artist` : undefined,
          }
        : undefined,
      inAlbum: album
        ? {
            '@type': 'MusicAlbum',
            name: album,
            '@id': albumId ? `${ORIGIN}/album/${slugify(album)}-${albumId}#album` : undefined,
          }
        : undefined,
      url: `${ORIGIN}/song/${slugify(d.name)}-${id}`,
      potentialAction: {
        '@type': 'ListenAction',
        target: [{ '@type': 'EntryPoint', urlTemplate: `${ORIGIN}/song/${slugify(d.name)}-${id}`, actionPlatform: ['https://schema.org/DesktopWebPlatform', 'https://schema.org/MobileWebPlatform', 'https://schema.org/AndroidPlatform'] }],
        expectsAcceptanceOf: { '@type': 'Offer', price: 0, priceCurrency: 'INR', eligibleRegion: { '@type': 'Country', name: 'IN' } },
      },
      isPartOf: { '@id': `${ORIGIN}/#website` },
    },
  };
}

// Mood x language hubs — KEEP IN SYNC with src/constants/hubs.ts and
// src/constants/languages.ts HUB_LANGUAGES (functions cannot import src/).
const HUB_LANGS = Object.keys(LANG_TAG);
const HUB_MOODS: Record<string, { label: string; query: string; blurb: string }> = {
  romantic: { label: 'Romantic', query: 'romantic hits', blurb: 'love songs and melodies for every heartbeat' },
  sad: { label: 'Sad', query: 'sad heartbreak songs', blurb: 'heartbreak and healing, one song at a time' },
  party: { label: 'Party', query: 'party dance hits', blurb: 'dance-floor anthems and beat drops' },
  devotional: { label: 'Devotional', query: 'devotional bhajan songs', blurb: 'bhajans and devotional classics' },
  melody: { label: 'Melody', query: 'melody hits', blurb: 'timeless melodies, soft and soulful' },
  workout: { label: 'Workout', query: 'workout gym motivation songs', blurb: 'high-energy tracks that keep you moving' },
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

/** Edge meta for a mood x language hub: unique title/desc/canonical,
 *  CollectionPage + ItemList JSON-LD, and a crawlable song list. */
export async function renderHub(
  lang: string,
  mood: string,
  request: Request,
  env: RenderEnv,
  waitUntil?: WaitUntil,
): Promise<Response> {
  try {
    const shellRes = await env.ASSETS.fetch(new URL('/index.html', request.url).toString());
    const shell = await shellRes.text();
    const hub = HUB_MOODS[mood];
    const label = capWord(lang);
    const path = `/${lang}-${mood}-songs`;
    const j = await fetchJson(`search/songs?query=${encodeURIComponent(`${lang} ${hub.query}`)}&limit=30`);
    const rawTracks: any[] = j?.data?.results ?? [];
    const tracks = songRows(rawTracks);
    // Every hub crawl teaches the SEO corpus 30 songs (+ albums + artists).
    harvestSoon(env, rawTracks.flatMap(songRowsDeep), waitUntil);
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
        ...(tracks.length
          ? {
              mainEntity: {
                '@type': 'ItemList',
                numberOfItems: Math.min(tracks.length, 25),
                itemListElement: tracks.slice(0, 25).map((t, i) => ({
                  '@type': 'ListItem',
                  position: i + 1,
                  name: t.title,
                  ...(t.id ? { url: `${ORIGIN}/song/${slugify(t.title)}-${t.id}` } : {}),
                })),
              },
            }
          : {}),
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
    const list = tracks.length
      ? `<ol>${tracks.slice(0, 30).map((t) => `<li>${t.id ? `<a href="/song/${esc(slugify(t.title))}-${esc(t.id)}">${esc(t.title)}</a>` : esc(t.title)}${t.artist ? ` \u2014 ${esc(t.artist)}` : ''}</li>`).join('')}</ol>`
      : '';
    const siblings = Object.keys(HUB_MOODS)
      .filter((k) => k !== mood)
      .map((k) => `<a href="/${lang}-${k}-songs">${label} ${HUB_MOODS[k].label} Songs</a>`)
      .join(' \u00b7 ');
    const content =
      `<main id="seo-content"><h1>${esc(label)} ${esc(hub.label)} Songs</h1>` +
      `<p>${esc(label)} ${esc(hub.label.toLowerCase())} songs \u2014 ${esc(hub.blurb)}. Stream free on VinaX: no login, no ads, synced lyrics and offline downloads.</p>` +
      list +
      `<p>${siblings}</p>` +
      `<nav aria-label="VinaX"><a href="/${lang}-songs">${esc(label)} Songs</a> <a href="/">Home</a> <a href="/charts">Charts</a> <a href="/discover">Discover</a></nav></main>`;
    const html = shell
      .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
      .replace(/(<meta name="description" content=")[^"]*(")/, `$1${esc(desc)}$2`)
      .replace(/<meta property="og:(type|title|description|image|image:width|image:height)" content="[^"]*"\s*\/?>/g, '')
      .replace(/<meta name="twitter:(card|image|title|description)" content="[^"]*"\s*\/?>/g, '')
      .replace('</head>', head);
    return new Response(injectContent(html, content), {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=3600, s-maxage=86400' },
    });
  } catch {
    return await env.ASSETS.fetch(request).catch(() => new Response('', { status: 500 }));
  }
}

export async function renderEntity(
  type: string,
  id: string,
  request: Request,
  env: RenderEnv,
  waitUntil?: WaitUntil,
): Promise<Response> {
  try {
    const shellRes = await env.ASSETS.fetch(new URL('/index.html', request.url).toString());
    const shell = await shellRes.text();
    const realId = idOf(id);
    const meta = await buildMeta(type, realId);
    if (!meta) {
      return new Response(shell, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    // Catalog names are unbounded — keep the description inside Bing's
    // 25–160 char window regardless of how long a title runs.
    meta.desc = clampDesc(meta.desc);
    // Feed the SEO corpus with everything this page knows (fire-and-forget:
    // the response never waits on the database, failures are invisible).
    harvestSoon(env, meta.harvestRows ?? [], waitUntil);
    const path = `/${type}/${slugify(meta.h1)}-${realId}`;
    const img = meta.image
      ? `<meta property="og:image" content="${esc(meta.image)}"/><meta property="og:image:width" content="500"/><meta property="og:image:height" content="500"/><meta name="twitter:image" content="${esc(meta.image)}"/><meta name="twitter:card" content="summary_large_image"/>` +
        `<meta name="twitter:title" content="${esc(meta.title)}"/><meta name="twitter:description" content="${esc(meta.desc)}"/>`
      : '';
    const music = (meta.music ?? [])
      .map(([k, v]) => `<meta property="${esc(k)}" content="${esc(v)}"/>`)
      .join('');
    const head =
      `<link rel="canonical" href="${ORIGIN}${path}"/>` +
      `<meta property="og:type" content="${esc(meta.ogType)}"/>` +
      `<meta property="og:title" content="${esc(meta.title)}"/>` +
      `<meta property="og:description" content="${esc(meta.desc)}"/>` +
      `<meta property="og:url" content="${ORIGIN}${path}"/>` +
      img +
      music +
      `<script type="application/ld+json">${jsonForScript(meta.crumbs ? [meta.jsonld, breadcrumbLd(meta.crumbs)] : meta.jsonld)}</script>` +
      `</head>`;
    const list = meta.tracks.length
      ? `<ol>${meta.tracks
          .slice(0, 40)
          .map((t) => `<li>${t.id ? `<a href="/song/${esc(slugify(t.title))}-${esc(t.id)}">${esc(t.title)}</a>` : esc(t.title)}${t.artist ? ` — ${esc(t.artist)}` : ''}</li>`)
          .join('')}</ol>`
      : '';
    const xlinks =
      meta.links && meta.links.length
        ? `<p>${meta.links.map((l) => `<a href="${esc(l.href)}">${esc(l.label)}</a>`).join(' · ')}</p>`
        : '';
    const content =
      `<main id="seo-content"><h1>${esc(meta.h1)}</h1><p>${esc(meta.sub)}</p>${meta.para ? `<p>${esc(meta.para)}</p>` : ''}${xlinks}` +
      (meta.image ? `<img src="${esc(meta.image)}" alt="${esc(meta.h1)}" width="300" height="300"/>` : '') +
      list +
      `<nav aria-label="VinaX"><a href="/">Home</a> <a href="/charts">Charts</a> <a href="/discover">Discover</a> <a href="/telugu-songs">Telugu Songs</a> <a href="/hindi-songs">Hindi Songs</a> <a href="/tamil-songs">Tamil Songs</a></nav></main>`;
    const html = shell
      .replace(/<title>[^<]*<\/title>/, `<title>${esc(meta.title)}</title>`)
      .replace(/(<meta name="description" content=")[^"]*(")/, `$1${esc(meta.desc)}$2`)
      // Strip the shell's STATIC og:/twitter: tags before injecting ours —
      // WhatsApp/Facebook/Twitter honor the FIRST tag they meet, so leaving
      // the generic site card in place meant every shared song link previewed
      // as "VinaX — music tuned to you" instead of the song (share-card bug).
      // og:site_name survives (entity cards should still carry the brand).
      .replace(/<meta property="og:(type|title|description|image|image:width|image:height)" content="[^"]*"\s*\/?>/g, '')
      .replace(/<meta name="twitter:(card|image|title|description)" content="[^"]*"\s*\/?>/g, '')
      .replace('</head>', head);
    return new Response(injectContent(html, content), {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'public, max-age=3600, s-maxage=86400',
      },
    });
  } catch {
    // Ultimate fallback: serve the normal SPA shell (via _redirects). Wrap in
    // .catch so a failing ASSETS.fetch here can't escape as an uncaught
    // rejection and blank the response (audit finding M-SRV-6).
    return await env.ASSETS.fetch(request).catch(() => new Response('', { status: 500 }));
  }
}
