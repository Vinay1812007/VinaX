import type { Song } from '../../src/types';

/**
 * The only things the evaluation replaces: the network-facing modules.
 *
 *   @/services/api                  the catalogue client — every candidate
 *                                   source reads it, so a fixture's pool and
 *                                   its outages are scripted HERE, one level
 *                                   below `candidates.ts`. That keeps the
 *                                   real candidate stage in the run: soft
 *                                   mutes, Kid mode, blocked songs and junk
 *                                   titles are filtered by the app's own code.
 *   @/services/queryClient          the cached owner flags.
 *
 * Everything else — filtering, scoring, diversity, sequencing, validation,
 * the stores — is the app's real code at the commit under evaluation.
 */

/** How a catalogue call behaves. */
export type Behaviour = 'ok' | 'throw' | 'never' | { delayMs: number };

export interface CatalogueScript {
  /** Suggestions for this id return `related`; any other id returns nothing. */
  seedId: string;
  related: Song[];
  /** Every catalogue search returns this list (the hard filter drops the repeats by id). */
  search: Song[];
  suggestions: Behaviour;
  searchBehaviour: Behaviour;
  /** Searches after this many calls never settle (the rest answer): one source hangs, the others do not. */
  searchNeverAfter: number | null;
  /** Deterministic delays, taken in call order, when a behaviour is 'slow'. */
  slow: boolean;
  /**
   * 8.3.0 — a search whose query names a style ("telugu dj remix", "telugu
   * folk songs") answers from this list instead, a page at a time, the way the
   * real catalogue answers those phrasings. Absent = every search answers
   * from `search`, as before.
   */
  styleSearch: { pattern: RegExp; songs: Song[] } | null;
  /**
   * 9.0.0 — album pages: `getAlbum(id)` answers with these songs (absent =
   * null, as before, so the album source adds nothing).
   */
  albums: Record<string, Song[]>;
  /** 9.0.0 — an artist page's "similar artists" list, by artist id. */
  similarArtists: Record<string, Array<{ id: string; name: string }>>;
  /**
   * 9.0.0 — songs only an artist page lists (an artist's catalogue that no
   * search or suggestion returns): what the related-artist source can add.
   */
  artistSongs: Song[];
  /** 9.0.0 — learned vectors the device already holds, by song id. */
}

export const catalogue: CatalogueScript = {
  seedId: '',
  related: [],
  search: [],
  suggestions: 'ok',
  searchBehaviour: 'ok',
  searchNeverAfter: null,
  slow: false,
  styleSearch: null,
  albums: {},
  similarArtists: {},
  artistSongs: [],
};

/** A fixed ladder of delays, taken in call order: a slow source is slow in a reproducible way. */
const SLOW_LADDER = [140, 420, 260, 900, 180, 610, 330, 760, 210, 480];
let calls = 0;
let searchCalls = 0;

export function resetCatalogue(script: Partial<CatalogueScript> = {}): void {
  Object.assign(catalogue, { seedId: '', related: [], search: [], suggestions: 'ok', searchBehaviour: 'ok', searchNeverAfter: null, slow: false, styleSearch: null, albums: {}, similarArtists: {}, artistSongs: [] }, script);
  calls = 0;
  searchCalls = 0;
}

/** Different queries return different windows of the search pool, as different searches would. */
function window(list: Song[], call: number): Song[] {
  if (list.length <= 20) return list;
  const start = (call * 20) % list.length;
  return [...list.slice(start), ...list.slice(0, start)];
}

function answer<T>(behaviour: Behaviour, value: T, slow: boolean): Promise<T> {
  const delay = slow ? SLOW_LADDER[calls++ % SLOW_LADDER.length] : typeof behaviour === 'object' ? behaviour.delayMs : 0;
  if (behaviour === 'throw') return Promise.reject(new Error('catalogue unavailable'));
  if (behaviour === 'never') return new Promise<T>(() => undefined);
  if (!delay) return Promise.resolve(value);
  return new Promise((resolve) => setTimeout(() => resolve(value), delay));
}

/** 9.0.0 — the fixture's artists by display name (lower-case), for artist-name searches. */
function artistByName(query: string): string | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  for (const s of [...catalogue.related, ...catalogue.search, ...catalogue.artistSongs]) {
    const a = s.artists?.[0];
    if (a && a.name.trim().toLowerCase() === q) return a.id;
  }
  return null;
}

function searchAnswer(query = '', page = 1): Promise<Song[]> {
  // 9.0.0 — a search for an artist's name answers with that artist's songs, as
  // the catalogue does. Until 9.0 it answered with the generic pool, so the
  // favourite-artist source appeared to supply other artists' songs (with its
  // boost) and crowded out the related-artist source.
  const artist = page === 1 || page === 2 || page === 3 ? artistByName(query) : null;
  if (artist) return answer(catalogue.searchBehaviour, artistCatalogue(artist), catalogue.slow);
  const style = catalogue.styleSearch;
  if (style && style.pattern.test(query)) {
    // A page of the style catalogue: page 2 starts where page 1 ended (wrapping).
    const n = style.songs.length;
    const start = n ? ((Math.max(1, page) - 1) * 12) % n : 0;
    return answer(catalogue.searchBehaviour, [...style.songs.slice(start), ...style.songs.slice(0, start)].slice(0, 20), catalogue.slow);
  }
  const call = searchCalls++;
  const hangs = catalogue.searchNeverAfter !== null && call >= catalogue.searchNeverAfter;
  return answer(hangs ? 'never' : catalogue.searchBehaviour, window(catalogue.search, call), catalogue.slow);
}

export const apiMock = {
  getSongSuggestions: (id: string, _n?: number): Promise<Song[]> =>
    answer(catalogue.suggestions, id === catalogue.seedId ? catalogue.related : [], catalogue.slow),
  searchSongsPage: (q: string, page?: number, _n?: number): Promise<Song[]> => searchAnswer(q, page),
  searchSongs: (q: string, _n?: number): Promise<Song[]> => searchAnswer(q, 1),
  // 9.0 — an album page answers with the fixture's album, like the catalogue's
  // album route; an unknown album (every fixture before 9.0) is null.
  getAlbum: (id: string): Promise<{ id: string; songs: Song[] } | null> =>
    answer(catalogue.searchBehaviour, catalogue.albums[id] ? { id, songs: catalogue.albums[id] } : null, catalogue.slow),
  // 9.0 — an artist page: its similar artists (when the fixture lists them)
  // and its top songs. Before 9.0 the mock had no artist page at all, so the
  // related-artist source fell through to top songs and found nobody.
  getArtist: (id: string): Promise<{ id: string; similarArtists: Array<{ id: string; name: string }>; topSongs: Song[] } | null> =>
    answer(catalogue.searchBehaviour, { id, similarArtists: catalogue.similarArtists[id] ?? [], topSongs: artistCatalogue(id) }, catalogue.slow),
  // 8.2 — an artist's catalogue is the songs of the fixture pool that credit
  // that artist (9.0: plus the songs only an artist page lists), answering like
  // a search does (the same outage behaviour).
  getArtistTopSongs: (id: string, _page?: number): Promise<Song[]> => answer(catalogue.searchBehaviour, artistCatalogue(id), catalogue.slow),
};

function artistCatalogue(id: string): Song[] {
  return [...catalogue.related, ...catalogue.search, ...catalogue.artistSongs].filter((s) => s.artists.some((a) => a.id === id));
}

export const queryClientMock = { queryClient: { getQueryData: (): undefined => undefined, setQueryData: (): undefined => undefined } };
