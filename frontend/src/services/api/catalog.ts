import type { Album, Artist, Lyrics, Playlist, SearchResults, Song } from '@/types';

/**
 * The music catalogue — empty.
 *
 * VinaX no longer uses any music provider: the JioSaavn catalogue behind
 * /api/cat, the community wrappers and the mirror ladder that reached them
 * were all removed. Every function below keeps its old signature so the
 * screens that call it still build, but none of them touches the network:
 * searches answer with nothing, and lookups of one song, album, playlist,
 * artist or lyric fail with CatalogUnavailableError, which the screens
 * already show as "not found" or an empty state.
 *
 * To bring music back, implement these functions against a new source.
 */

/** How a catalogue call is allotted. Kept for callers' signatures. */
export type RequestPriority = 'interactive' | 'standard' | 'background';

/** Catalogue call options. Kept for callers' signatures. */
export interface CatalogOpts {
  signal?: AbortSignal;
  priority?: RequestPriority;
}

export class CatalogUnavailableError extends Error {
  constructor() {
    super('No music catalogue is configured');
    this.name = 'CatalogUnavailableError';
  }
}

const nothing = <T>(): Promise<T[]> => Promise.resolve([]);
const unavailable = <T>(): Promise<T> => Promise.reject(new CatalogUnavailableError());

export function searchSongs(_query: string, _limit = 25, _opts?: CatalogOpts): Promise<Song[]> {
  return nothing();
}

export function searchSongsPage(_query: string, _page: number, _limit = 25, _opts?: CatalogOpts): Promise<Song[]> {
  return nothing();
}

export function searchAlbums(_query: string, _limit = 20, _opts?: CatalogOpts): Promise<Album[]> {
  return nothing();
}

export function searchAlbumsPage(_query: string, _page: number, _limit = 20, _opts?: CatalogOpts): Promise<Album[]> {
  return nothing();
}

export function searchArtists(_query: string, _limit = 20, _opts?: CatalogOpts): Promise<Artist[]> {
  return nothing();
}

export function searchArtistsPage(_query: string, _page: number, _limit = 20, _opts?: CatalogOpts): Promise<Artist[]> {
  return nothing();
}

export function searchPlaylists(_query: string, _limit = 20, _opts?: CatalogOpts): Promise<Playlist[]> {
  return nothing();
}

export function searchPlaylistsPage(_query: string, _page: number, _limit = 20, _opts?: CatalogOpts): Promise<Playlist[]> {
  return nothing();
}

export function searchAll(_query: string, _opts?: CatalogOpts): Promise<SearchResults> {
  return Promise.resolve({ songs: [], albums: [], artists: [], playlists: [] });
}

export function getSong(_id: string, _opts?: CatalogOpts): Promise<Song> {
  return unavailable();
}

export function getSongSuggestions(_id: string, _limit = 15, _opts?: CatalogOpts): Promise<Song[]> {
  return nothing();
}

export function getAlbum(_id: string, _opts?: CatalogOpts): Promise<Album> {
  return unavailable();
}

export function getPlaylist(_id: string, _limit = 100): Promise<Playlist> {
  return unavailable();
}

export function getArtist(_id: string): Promise<Artist> {
  return unavailable();
}

export function getArtistTopSongs(_id: string, _page = 0): Promise<Song[]> {
  return nothing();
}

export function getLyrics(_id: string): Promise<Lyrics> {
  return unavailable();
}
