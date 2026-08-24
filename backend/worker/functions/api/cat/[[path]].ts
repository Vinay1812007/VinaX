/**
 * Self-hosted catalog API (4.20.0) — /api/cat/* speaks the same route dialect
 * as the community JioSaavn wrappers the client already uses, but lives on
 * OUR origin and talks straight to JioSaavn's public web API.
 *
 * Why: 2026-08-18 total catalog outage — saavn.sumit.co started answering
 * 429 (rate-limited) and nepotuneapi.vercel.app 402 (Vercel bill), taking
 * down shelves, search, next-song and the AI DJ at once. Every community
 * mirror is somebody else's weekend project; this one scales with the site
 * and cannot be turned off from outside. External mirrors remain in the
 * client's fallback ladder BEHIND this base.
 *
 * Streams: upstream v4 payloads carry encrypted_media_url. Songs get
 * downloadUrl entries pointing at /api/cat/stream?e=<encrypted>&q=<bitrate>;
 * at PLAY time that endpoint DES-decrypts the encrypted url locally
 * (functions/_lib/des.ts) and 302s to the direct, unsigned aac.saavncdn.com
 * URL — audio bytes never proxy through us, and CSP's `media-src https:`
 * already allows the CDN. Play-outage fix 2026-08-20: this used to ask
 * upstream song.generateAuthToken instead, but the signed web.saavncdn.com
 * URLs that call hands to Cloudflare-edge callers began answering
 * "Access Denied", stalling every play; generateAuthToken remains only as
 * a fallback for inputs the decryptor can't parse.
 *
 * Path shape: [[path]] catch-all param segment — NOT a new dotted function
 * filename (dotted names kill the whole Pages deploy; ops rule from the
 * 4.14.x ads.txt outage).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { decryptMediaUrl } from '../../_lib/des';

const UPSTREAM = 'https://www.jiosaavn.com/api.php';
const COMMON = '_format=json&_marker=0&api_version=4&ctx=web6dot0';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function upstream(params: string): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 7000);
  try {
    const r = await fetch(`${UPSTREAM}?${params}&${COMMON}`, {
      headers: { accept: 'application/json', 'user-agent': UA },
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`upstream ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

const BITRATES = ['48', '96', '160', '320'];

/** Play-time resolver URLs for a raw upstream song (no DES: see /stream). */
export function streamUrls(raw: any, origin: string): Array<{ quality: string; url: string }> {
  const enc = raw?.more_info?.encrypted_media_url ?? raw?.encrypted_media_url;
  if (typeof enc !== 'string' || !enc) return [];
  return BITRATES.map((q) => ({
    quality: `${q}kbps`,
    url: `${origin}/api/cat/stream?e=${encodeURIComponent(enc)}&q=${q}`,
  }));
}

/** Light massage: raw v4 objects already match the client's normalize.ts
 *  (more_info.artistMap, string images, top-level language/year) — we only
 *  add `name` (client checks name before title) and the downloadUrl array. */
export function mapSong(raw: any, origin: string): any {
  if (!raw || typeof raw !== 'object') return raw;
  const prim = raw?.more_info?.artistMap?.primary_artists;
  return {
    ...raw,
    name: raw.title ?? raw.name,
    // Flattened for consumers that don't dig into more_info (the edge
    // renderer's songRows, some client subtitle fallbacks).
    primaryArtists: Array.isArray(prim) ? prim.map((a: any) => a?.name).filter(Boolean).join(', ') : raw.primaryArtists,
    downloadUrl: streamUrls(raw, origin),
  };
}

function mapList(list: unknown, origin: string): any[] {
  return Array.isArray(list) ? list.map((s) => mapSong(s, origin)) : [];
}

function json(data: unknown, sMaxAge = 600): Response {
  return new Response(JSON.stringify({ success: true, data }), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=60, s-maxage=${sMaxAge}`,
      'access-control-allow-origin': '*',
    },
  });
}

const nf = () => new Response(JSON.stringify({ success: false, data: null }), { status: 404, headers: { 'content-type': 'application/json' } });

export const onRequestGet = async (context: { request: Request; params: { path?: string[] } }): Promise<Response> => {
  const url = new URL(context.request.url);
  const origin = url.origin;
  const seg = (context.params.path ?? []).map((s) => decodeURIComponent(String(s)));
  const q = (k: string) => url.searchParams.get(k) ?? '';
  const limit = Math.min(Number(q('limit') || q('n') || 20) || 20, 50);
  const page = Math.max(Number(q('page') || q('p') || 1) || 1, 1);

  try {
    // /stream?e=<encrypted>&q=<bitrate> → 302 to the real CDN URL.
    if (seg[0] === 'stream') {
      const enc = q('e');
      const rate = BITRATES.includes(q('q')) ? q('q') : '160';
      if (!enc) return nf();
      // Primary: local DES decrypt → direct unsigned CDN URL. The decrypted
      // URL carries a default bitrate suffix (usually _96); swap it for the
      // requested one — a missing variant 404s and the client's audio engine
      // simply advances to its next quality source.
      const direct = decryptMediaUrl(enc);
      if (direct) {
        const url = direct.replace(/_(?:12|48|96|160|320)(\.\w+)$/, `_${rate}$1`);
        // Deterministic mapping (no expiring token), so the redirect is
        // cacheable at the edge.
        return new Response(null, {
          status: 302,
          headers: { location: url, 'cache-control': 'public, max-age=86400' },
        });
      }
      // Fallback for inputs the decryptor can't parse: upstream auth token.
      const j = await upstream(`__call=song.generateAuthToken&url=${encodeURIComponent(enc)}&bitrate=${rate}`);
      const auth = typeof j?.auth_url === 'string' ? j.auth_url : typeof j?.[0]?.auth_url === 'string' ? j[0].auth_url : '';
      if (!auth.startsWith('http')) return nf();
      // NOT Response.redirect(): that normalizes the URL and can percent-
      // encode signature characters (…&Signature=abc~def), invalidating the
      // CDN's signed URL. Emit the Location header byte-for-byte.
      return new Response(null, {
        status: 302,
        headers: { location: auth.replace(/^http:/, 'https:'), 'cache-control': 'no-store' },
      });
    }

    // /search/songs|albums|artists|playlists?query=&page=&limit=
    if (seg[0] === 'search' && seg[1]) {
      const CALLS: Record<string, string> = {
        songs: 'search.getResults',
        albums: 'search.getAlbumResults',
        artists: 'search.getArtistResults',
        playlists: 'search.getPlaylistResults',
      };
      const call = CALLS[seg[1]];
      if (!call) return nf();
      const j = await upstream(`__call=${call}&q=${encodeURIComponent(q('query'))}&n=${limit}&p=${page}`);
      const results = Array.isArray(j?.results) ? j.results : [];
      return json({ results: seg[1] === 'songs' ? mapList(results, origin) : results });
    }

    // /search?query= → grouped autocomplete (client reads d.<kind>.data).
    if (seg[0] === 'search') {
      const j = await upstream(`__call=autocomplete.get&query=${encodeURIComponent(q('query'))}&cc=in&includeMetaTags=1`);
      return json({
        songs: { data: mapList(j?.songs?.data, origin) },
        albums: { data: j?.albums?.data ?? [] },
        artists: { data: j?.artists?.data ?? [] },
        playlists: { data: j?.playlists?.data ?? [] },
      });
    }

    // /songs/:id | /songs?id=   (+ /songs/:id/suggestions, /songs/:id/lyrics)
    if (seg[0] === 'songs' || seg[0] === 'song') {
      const id = seg[1] && seg[1] !== 'undefined' ? seg[1] : q('id');
      if (!id) return nf();
      if (seg[2] === 'suggestions') {
        const j = await upstream(`__call=reco.getreco&pid=${encodeURIComponent(id)}`);
        const list = Array.isArray(j) ? j : Array.isArray(j?.data) ? j.data : [];
        return json(mapList(list, origin), 1800);
      }
      if (seg[2] === 'lyrics') {
        const j = await upstream(`__call=lyrics.getLyrics&lyrics_id=${encodeURIComponent(id)}`);
        return json(j, 86400);
      }
      const j = await upstream(`__call=song.getDetails&pids=${encodeURIComponent(id)}`);
      const list = Array.isArray(j?.songs) ? j.songs : [];
      return json(mapList(list, origin), 3600);
    }

    // /albums?id= | /albums/:id
    if (seg[0] === 'albums' || seg[0] === 'album') {
      const id = seg[1] ?? q('id');
      if (!id) return nf();
      const j = await upstream(`__call=content.getAlbumDetails&albumid=${encodeURIComponent(id)}`);
      if (!j || typeof j !== 'object') return nf();
      return json({ ...j, name: j.title ?? j.name, songs: mapList(j.list, origin) }, 3600);
    }

    // /playlists?id= | /playlist?id=
    if (seg[0] === 'playlists' || seg[0] === 'playlist') {
      const id = seg[1] ?? q('id');
      if (!id) return nf();
      const j = await upstream(`__call=playlist.getDetails&listid=${encodeURIComponent(id)}&n=${Math.min(Number(q('limit') || 100) || 100, 200)}&p=1`);
      if (!j || typeof j !== 'object') return nf();
      return json({ ...j, name: j.title ?? j.listname ?? j.name, songs: mapList(j.list, origin) }, 1800);
    }

    // /artists/:id (+ /artists/:id/songs)
    if (seg[0] === 'artists' || seg[0] === 'artist') {
      const id = seg[1] ?? q('id');
      if (!id) return nf();
      const j = await upstream(`__call=artist.getArtistPageDetails&artistId=${encodeURIComponent(id)}`);
      if (!j || typeof j !== 'object') return nf();
      const top = mapList(j.topSongs?.songs ?? j.topSongs, origin);
      if (seg[2] === 'songs') return json({ songs: top }, 1800);
      return json({ ...j, id: j.artistId ?? j.id ?? id, topSongs: top }, 3600);
    }

    // /lyrics?id=
    if (seg[0] === 'lyrics') {
      const id = q('id');
      if (!id) return nf();
      const j = await upstream(`__call=lyrics.getLyrics&lyrics_id=${encodeURIComponent(id)}`);
      return json(j, 86400);
    }

    return nf();
  } catch {
    // Upstream failure → 502 so the client's orchestrator moves down its
    // fallback ladder instead of treating an empty 200 as a real answer.
    return new Response(JSON.stringify({ success: false, data: null }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  }
};
