import type { Album, Artist, Lyrics, Playlist, SearchResults, Song } from '@/types';
import { orchestratedRequest } from './client';
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

function listFrom(d: unknown): unknown[] | null {
  if (Array.isArray(d)) return d;
  const obj = d as Record<string, unknown> | null;
  if (Array.isArray(obj?.results)) return obj.results as unknown[];
  if (Array.isArray(obj?.songs)) return obj.songs as unknown[];
  return null;
}

export function searchSongs(query: string, limit = 25): Promise<Song[]> {
  return orchestratedRequest({
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
export function searchSongsPage(query: string, page: number, limit = 25): Promise<Song[]> {
  return orchestratedRequest({
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

export function searchAlbums(query: string, limit = 20): Promise<Album[]> {
  return orchestratedRequest({
    paths: [`/search/albums?query=${enc(query)}&limit=${limit}`],
    validate: (json) => {
      const list = listFrom(unwrap(json));
      if (!list) return null;
      return list.map(normalizeAlbum).filter((a): a is Album => a !== null);
    },
  });
}

export function searchAlbumsPage(query: string, page: number, limit = 20): Promise<Album[]> {
  return orchestratedRequest({
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

export function searchArtists(query: string, limit = 20): Promise<Artist[]> {
  return orchestratedRequest({
    paths: [`/search/artists?query=${enc(query)}&limit=${limit}`],
    validate: (json) => {
      const list = listFrom(unwrap(json));
      if (!list) return null;
      return list.map(normalizeArtist).filter((a): a is Artist => a !== null);
    },
  });
}

export function searchPlaylists(query: string, limit = 20): Promise<Playlist[]> {
  return orchestratedRequest({
    paths: [`/search/playlists?query=${enc(query)}&limit=${limit}`],
    validate: (json) => {
      const list = listFrom(unwrap(json));
      if (!list) return null;
      return list.map(normalizePlaylist).filter((p): p is Playlist => p !== null);
    },
  });
}

export function searchAll(query: string): Promise<SearchResults> {
  return orchestratedRequest({
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
      if (!songs.length && !albums.length && !artists.length && !playlists.length) {
        // Some wrappers 200-with-empty on /search; treat as miss so the
        // orchestrator can try a provider that actually implements it.
        return null;
      }
      return { songs, albums, artists, playlists };
    },
  });
}

export function getSong(id: string): Promise<Song> {
  return orchestratedRequest({
    paths: [`/songs/${enc(id)}`, `/songs?id=${enc(id)}`, `/song?id=${enc(id)}`],
    validate: (json) => {
      const d = unwrap(json);
      const raw = Array.isArray(d) ? d[0] : Array.isArray(d?.results) ? d.results[0] : d;
      return normalizeSong(raw);
    },
  });
}

export function getSongSuggestions(id: string, limit = 15): Promise<Song[]> {
  return orchestratedRequest({
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

export function getAlbum(id: string): Promise<Album> {
  return orchestratedRequest({
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

export function getArtistTopSongs(id: string, page = 0): Promise<Song[]> {
  return orchestratedRequest({
    paths: [
      `/artists/${enc(id)}/songs?page=${page}&sortBy=popularity&sortOrder=desc`,
      `/artists/${enc(id)}/songs`,
    ],
    validate: (json) => {
      const d = unwrap(json);
      const list = listFrom(d) ?? (Array.isArray(d?.songs) ? d.songs : null);
      if (!list) return null;
      const songs = normalizeSongList(list);
      return songs.length ? songs : null;
    },
  });
}

export function getLyrics(id: string): Promise<Lyrics> {
  return orchestratedRequest({
    paths: [`/songs/${enc(id)}/lyrics`, `/lyrics?id=${enc(id)}`],
    validate: (json) => normalizeLyrics(unwrap(json)),
  });
}
