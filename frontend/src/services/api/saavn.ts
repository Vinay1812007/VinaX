import type { Album, Artist, Lyrics, Playlist, SearchResults, Song } from '@/types';
import { rewriteQuery } from '@/services/search/synonyms';
import { orchestratedRequest, type RequestPriority } from './client';
import {
  normalizeAlbum,
  normalizeArtist,
  normalizeLyrics,
  normalizePlaylist,
  normalizeSong,
  normalizeSongList,
  unwrap,
} from './normalize';

const enc = encodeURIComponent;

/** Catalogue call options. Search defaults to `background` allotment (most
 *  callers are shelves and recommendations); the Search page, typeahead and
 *  song lookups pass `interactive` and are hedged. */
export interface CatalogOpts {
  signal?: AbortSignal;
  priority?: RequestPriority;
}

/** Identical search GETs within this window share one call (typeahead repeats). */
export const SEARCH_MEMO_MS = 5000;

const searchReq = (opts?: CatalogOpts) => ({
  signal: opts?.signal,
  priority: opts?.priority ?? ('background' as const),
  cacheMs: SEARCH_MEMO_MS,
});

function listFrom(d: unknown): unknown[] | null {
  if (Array.isArray(d)) return d;
  const obj = d as Record<string, unknown> | null;
  if (Array.isArray(obj?.results)) return obj.results as unknown[];
  if (Array.isArray(obj?.songs)) return obj.songs as unknown[];
  return null;
}

export function searchSongs(rawQuery: string, limit = 25, opts?: CatalogOpts): Promise<Song[]> {
  const query = rewriteQuery(rawQuery);
  return orchestratedRequest({
    ...searchReq(opts),
    paths: [
      `/search/songs?query=${enc(query)}&limit=${limit}`,
      `/search/songs?query=${enc(query)}&page=1&limit=${limit}`,
    ],
    validate: (json) => {
      const list = listFrom(unwrap(json));
      return list ? normalizeSongList(list) : null;
    },
  });
}

/** Paged song search — powers infinite scroll. Page is 1-based. */
export function searchSongsPage(rawQuery: string, page: number, limit = 25, opts?: CatalogOpts): Promise<Song[]> {
  const query = rewriteQuery(rawQuery);
  return orchestratedRequest({
    ...searchReq(opts),
    paths: [
      `/search/songs?query=${enc(query)}&page=${page}&limit=${limit}`,
      `/search/songs?query=${enc(query)}&p=${page}&limit=${limit}`,
    ],
    validate: (json) => {
      const list = listFrom(unwrap(json));
      return list ? normalizeSongList(list) : null;
    },
  });
}

// Every search entry point runs the admin synonym table first, so a published
// alias ("arr") finds the same artist on the Albums / Artists / Playlists tabs
// and the All tab as it does on Songs.
export function searchAlbums(rawQuery: string, limit = 20, opts?: CatalogOpts): Promise<Album[]> {
  const query = rewriteQuery(rawQuery);
  return orchestratedRequest({
    ...searchReq(opts),
    paths: [`/search/albums?query=${enc(query)}&limit=${limit}`],
    validate: (json) => {
      const list = listFrom(unwrap(json));
      if (!list) return null;
      return list.map(normalizeAlbum).filter((a): a is Album => a !== null);
    },
  });
}

export function searchAlbumsPage(rawQuery: string, page: number, limit = 20, opts?: CatalogOpts): Promise<Album[]> {
  const query = rewriteQuery(rawQuery);
  return orchestratedRequest({
    ...searchReq(opts),
    paths: [
      `/search/albums?query=${enc(query)}&page=${page}&limit=${limit}`,
      `/search/albums?query=${enc(query)}&p=${page}&limit=${limit}`,
    ],
    validate: (json) => {
      const list = listFrom(unwrap(json));
      if (!list) return null;
      return list.map(normalizeAlbum).filter((a): a is Album => a !== null);
    },
  });
}

export function searchArtists(rawQuery: string, limit = 20, opts?: CatalogOpts): Promise<Artist[]> {
  const query = rewriteQuery(rawQuery);
  return orchestratedRequest({
    ...searchReq(opts),
    paths: [`/search/artists?query=${enc(query)}&limit=${limit}`],
    validate: (json) => {
      const list = listFrom(unwrap(json));
      if (!list) return null;
      return list.map(normalizeArtist).filter((a): a is Artist => a !== null);
    },
  });
}

export function searchPlaylists(rawQuery: string, limit = 20, opts?: CatalogOpts): Promise<Playlist[]> {
  const query = rewriteQuery(rawQuery);
  return orchestratedRequest({
    ...searchReq(opts),
    paths: [`/search/playlists?query=${enc(query)}&limit=${limit}`],
    validate: (json) => {
      const list = listFrom(unwrap(json));
      if (!list) return null;
      return list.map(normalizePlaylist).filter((p): p is Playlist => p !== null);
    },
  });
}

/** Paged artist search (P2-30 follow-up: the tab was capped at 20). Same
 *  page/p fallback ladder that already works for songs and albums; mirrors
 *  that ignore paging repeat page 1, which the client de-dupes by id and
 *  treats as end-of-results. Page is 1-based. */
export function searchArtistsPage(rawQuery: string, page: number, limit = 20, opts?: CatalogOpts): Promise<Artist[]> {
  const query = rewriteQuery(rawQuery);
  return orchestratedRequest({
    ...searchReq(opts),
    paths: [
      `/search/artists?query=${enc(query)}&page=${page}&limit=${limit}`,
      `/search/artists?query=${enc(query)}&p=${page}&limit=${limit}`,
    ],
    validate: (json) => {
      const list = listFrom(unwrap(json));
      if (!list) return null;
      return list.map(normalizeArtist).filter((a): a is Artist => a !== null);
    },
  });
}

/** Paged playlist search — twin of searchArtistsPage. */
export function searchPlaylistsPage(rawQuery: string, page: number, limit = 20, opts?: CatalogOpts): Promise<Playlist[]> {
  const query = rewriteQuery(rawQuery);
  return orchestratedRequest({
    ...searchReq(opts),
    paths: [
      `/search/playlists?query=${enc(query)}&page=${page}&limit=${limit}`,
      `/search/playlists?query=${enc(query)}&p=${page}&limit=${limit}`,
    ],
    validate: (json) => {
      const list = listFrom(unwrap(json));
      if (!list) return null;
      return list.map(normalizePlaylist).filter((p): p is Playlist => p !== null);
    },
  });
}

/** 13.7 — put topQuery's items first in their own groups (by type), once each. */
export function mergeTopQuery(raw: unknown, into: SearchResults): void {
  const group = raw as { results?: unknown; data?: unknown } | null | undefined;
  const items = Array.isArray(group?.results) ? group.results : Array.isArray(group?.data) ? group.data : [];
  const lead = <T extends { id: string }>(list: T[], item: T | null): void => {
    if (!item) return;
    const at = list.findIndex((x) => x.id === item.id);
    if (at >= 0) list.splice(at, 1);
    list.unshift(item);
  };
  // Reverse so the first topQuery item ends up first.
  for (const it of [...items].reverse()) {
    const type = (it as { type?: unknown })?.type;
    if (type === 'artist') {
      const a = normalizeArtist(it);
      lead(into.artists, a);
      if (a) into.topArtistId = a.id;
    }
    else if (type === 'album') lead(into.albums, normalizeAlbum(it));
    else if (type === 'playlist') lead(into.playlists, normalizePlaylist(it));
    else if (type === 'song') lead(into.songs, normalizeSongList([it])[0] ?? null);
  }
}

export function searchAll(rawQuery: string, opts?: CatalogOpts): Promise<SearchResults> {
  const query = rewriteQuery(rawQuery);
  return orchestratedRequest({
    ...searchReq(opts),
    paths: [`/search?query=${enc(query)}`],
    validate: (json) => {
      const d = unwrap(json);
      if (!d || typeof d !== 'object') return null;
      const songs = normalizeSongList(d.songs?.results ?? d.songs?.data ?? []);
      const albums = ((d.albums?.results ?? d.albums?.data ?? []) as unknown[])
        .map(normalizeAlbum)
        .filter((a): a is Album => a !== null);
      const artists = ((d.artists?.results ?? d.artists?.data ?? []) as unknown[])
        .map(normalizeArtist)
        .filter((a): a is Artist => a !== null);
      const playlists = ((d.playlists?.results ?? d.playlists?.data ?? []) as unknown[])
        .map(normalizePlaylist)
        .filter((p): p is Playlist => p !== null);
      // 13.7 — the catalogue's best match arrives only in topQuery (both
      // servers send it): "arijit" names the artist Arijit Singh there while
      // the three artist rows are duets and a namesake. Lead its group with it.
      if (!songs.length && !albums.length && !artists.length && !playlists.length) {
        // A supported, explicitly empty list is a valid zero-result search.
        // Unsupported shapes still try the next provider.
        const hasResultList = [d.songs, d.albums, d.artists, d.playlists].some(
          (group) => Array.isArray(group?.results) || Array.isArray(group?.data),
        );
        if (!hasResultList) return null;
      }
      const out: SearchResults = { songs, albums, artists, playlists };
      mergeTopQuery(d.topQuery ?? d.topquery, out);
      return out;
    },
  });
}

export function getSong(id: string, opts?: CatalogOpts): Promise<Song> {
  return orchestratedRequest({
    signal: opts?.signal,
    // Song lookup is what a tap waits on: best endpoint, hedged.
    priority: opts?.priority ?? 'interactive',
    cacheMs: SEARCH_MEMO_MS,
    paths: [`/songs/${enc(id)}`, `/songs?id=${enc(id)}`, `/song?id=${enc(id)}`],
    validate: (json) => {
      const d = unwrap(json);
      const raw = Array.isArray(d) ? d[0] : Array.isArray(d?.results) ? d.results[0] : d;
      return normalizeSong(raw);
    },
  });
}

export function getSongSuggestions(id: string, limit = 15, opts?: CatalogOpts): Promise<Song[]> {
  return orchestratedRequest({
    signal: opts?.signal,
    priority: opts?.priority,
    paths: [
      `/songs/${enc(id)}/suggestions?limit=${limit}`,
      `/songs/${enc(id)}/suggestions`,
    ],
    validate: (json) => {
      const list = listFrom(unwrap(json));
      if (!list) return null;
      const songs = normalizeSongList(list);
      return songs.length ? songs : null;
    },
  });
}

export function getAlbum(id: string, opts?: CatalogOpts): Promise<Album> {
  return orchestratedRequest({
    signal: opts?.signal,
    priority: opts?.priority,
    paths: [`/albums?id=${enc(id)}`, `/albums/${enc(id)}`, `/album?id=${enc(id)}`],
    validate: (json) => normalizeAlbum(unwrap(json)),
  });
}

export function getPlaylist(id: string, limit = 100): Promise<Playlist> {
  return orchestratedRequest({
    paths: [
      `/playlists?id=${enc(id)}&limit=${limit}`,
      `/playlists?id=${enc(id)}`,
      `/playlist?id=${enc(id)}`,
    ],
    validate: (json) => normalizePlaylist(unwrap(json)),
  });
}

export function getArtist(id: string): Promise<Artist> {
  return orchestratedRequest({
    paths: [`/artists/${enc(id)}`, `/artists?id=${enc(id)}`],
    validate: (json) => normalizeArtist(unwrap(json)),
  });
}

/** Artist catalogue by popularity. Page is 0-based. The unpaged dialect is a
 *  first-page fallback ONLY: on a later page it would serve page 1 again, and
 *  the list would repeat forever. Past page 0 a well-formed empty list is the
 *  end of the catalogue, not a shape miss. */
export function getArtistTopSongs(id: string, page = 0): Promise<Song[]> {
  const paged = `/artists/${enc(id)}/songs?page=${page}&sortBy=popularity&sortOrder=desc`;
  return orchestratedRequest({
    paths: page === 0 ? [paged, `/artists/${enc(id)}/songs`] : [paged],
    validate: (json) => {
      const d = unwrap(json);
      const list = listFrom(d) ?? (Array.isArray(d?.songs) ? d.songs : null);
      if (!list) return null;
      const songs = normalizeSongList(list);
      if (songs.length) return songs;
      return page > 0 ? [] : null;
    },
  });
}

/** 1.3 — asks for synced lines too (the wrapper matches them server-side);
 *  bases that ignore the flag still answer the plain text. */
export function getLyrics(id: string): Promise<Lyrics> {
  return orchestratedRequest({
    paths: [`/songs/${enc(id)}/lyrics?synced=true`, `/songs/${enc(id)}/lyrics`, `/lyrics?id=${enc(id)}`],
    // v5.7.2 — lyrics race an 8s UI deadline in useSyncedLyrics. A cold or
    // hung primary must not eat the whole budget before the ladder reaches a
    // base that actually serves the lyrics route: time out fast per attempt.
    timeoutMs: 3500,
    validate: (json) => normalizeLyrics(unwrap(json)),
  });
}
