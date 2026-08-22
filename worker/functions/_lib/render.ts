/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Edge render for dynamic detail pages (/album|artist|playlist|song/:id).
 * Fetches the entity from the upstream music API and injects real title,
 * description, OG image, JSON-LD and a crawlable content block into the SPA
 * shell. Fully defensive: any failure falls back to the plain SPA shell, so a
 * dead provider or timeout never breaks the page. Edge-cached for an hour.
 */
const SAAVN = 'https://saavn.dev/api';
const ORIGIN = 'https://www.sirimillavinay.online';

interface Assets {
  ASSETS: { fetch: (req: Request | string | URL) => Promise<Response> };
}

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

async function fetchJson(url: string): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2200);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface Meta {
  crumbs?: Crumb[];
  title: string;
  desc: string;
  image: string;
  h1: string;
  sub: string;
  tracks: Array<{ id: string; title: string; artist: string }>;
  links?: Array<{ href: string; label: string }>;
  jsonld: Record<string, unknown>;
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
    const j = await fetchJson(`${SAAVN}/albums?id=${encodeURIComponent(id)}`);
    const d = j?.data;
    if (!d?.name) return null;
    const artist = artistNames(d.artists ?? d.primaryArtists);
    const image = bestImg(d.image);
    const tracks = songRows(d.songs);
    const year = d.year ? ` (${d.year})` : '';
    return {
      crumbs: [{ name: 'Home', item: `${ORIGIN}/` }, ...hubCrumbs(d.language), { name: String(d.name) }],
      title: `${d.name}${year} — Album · VinaX`,
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
    const j = await fetchJson(`${SAAVN}/playlists?id=${encodeURIComponent(id)}`);
    const d = j?.data;
    if (!d?.name) return null;
    const image = bestImg(d.image);
    const tracks = songRows(d.songs);
    return {
      crumbs: [{ name: 'Home', item: `${ORIGIN}/` }, { name: String(d.name) }],
      title: `${d.name} — Playlist · VinaX`,
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
    const j = await fetchJson(`${SAAVN}/artists/${encodeURIComponent(id)}`);
    const d = j?.data ?? j;
    if (!d?.name) return null;
    const image = bestImg(d.image);
    return {
      crumbs: [{ name: 'Home', item: `${ORIGIN}/` }, { name: String(d.name) }],
      title: `${d.name} — Songs & Albums · VinaX`,
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
  const j = await fetchJson(`${SAAVN}/songs/${encodeURIComponent(id)}`);
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
    crumbs: [
      { name: 'Home', item: `${ORIGIN}/` },
      ...hubCrumbs(lang),
      ...(album && albumId ? [{ name: String(album), item: `${ORIGIN}/album/${slugify(album)}-${albumId}` }] : []),
      { name: String(d.name) },
    ],
    title: `${d.name}${artist ? ` by ${artist}` : ''} · VinaX`,
    desc: `Listen to ${d.name}${artist ? ` by ${artist}` : ''}${album ? ` from ${album}` : ''}${year ? ` (${year})` : ''} on VinaX — free, no login.`,
    image,
    h1: d.name,
    sub: `Song${artist ? ` · ${artist}` : ''}${album ? ` · ${album}` : ''}${lang ? ` · ${lang}` : ''}${year ? ` · ${year}` : ''}`,
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
      isPartOf: { '@id': `${ORIGIN}/#website` },
    },
  };
}

export async function renderEntity(
  type: string,
  id: string,
  request: Request,
  env: Assets,
): Promise<Response> {
  try {
    const shellRes = await env.ASSETS.fetch(new URL('/index.html', request.url).toString());
    const shell = await shellRes.text();
    const realId = idOf(id);
    const meta = await buildMeta(type, realId);
    if (!meta) {
      return new Response(shell, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    const path = `/${type}/${slugify(meta.h1)}-${realId}`;
    const img = meta.image
      ? `<meta property="og:image" content="${esc(meta.image)}"/><meta property="og:image:width" content="500"/><meta property="og:image:height" content="500"/><meta name="twitter:image" content="${esc(meta.image)}"/><meta name="twitter:card" content="summary_large_image"/>`
      : '';
    const head =
      `<link rel="canonical" href="${ORIGIN}${path}"/>` +
      `<meta property="og:title" content="${esc(meta.title)}"/>` +
      `<meta property="og:description" content="${esc(meta.desc)}"/>` +
      `<meta property="og:url" content="${ORIGIN}${path}"/>` +
      img +
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
      `<div id="seo-content"><h1>${esc(meta.h1)}</h1><p>${esc(meta.sub)}</p>${xlinks}` +
      (meta.image ? `<img src="${esc(meta.image)}" alt="${esc(meta.h1)}" width="300" height="300"/>` : '') +
      list +
      `<nav aria-label="VinaX"><a href="/">Home</a> <a href="/charts">Charts</a> <a href="/discover">Discover</a> <a href="/telugu-songs">Telugu Songs</a> <a href="/hindi-songs">Hindi Songs</a> <a href="/tamil-songs">Tamil Songs</a></nav></div>`;
    const html = shell
      .replace(/<title>[^<]*<\/title>/, `<title>${esc(meta.title)}</title>`)
      .replace(/(<meta name="description" content=")[^"]*(")/, `$1${esc(meta.desc)}$2`)
      .replace('</head>', head)
      .replace('<div id="seo-slot"></div>', content);
    return new Response(html, {
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
