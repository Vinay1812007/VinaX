import type { Album, ArtistRef, ImageVariant, Playlist, Song } from '@/types';
import { decodeHtml } from '@/utils/format';
import { orchestratedRequest, type RequestPriority } from './client';
import { normalizeAlbum, normalizePlaylist, normalizeSongList, toAudio, toImages, unwrap } from './normalize';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 1.3 — the catalogue routes the VinaX Music API added in its October docs
 * (musicapi.vinaxmusic.online/docs): home feed, trending, new releases,
 * charts, featured playlists, moods and genres, radio stations, podcasts,
 * top searches and similar albums/artists. They reach the app through
 * /api/cat, which forwards them to the configured wrapper; the Worker's
 * built-in direct translation does not know them, so when the wrapper is
 * down they fail and every caller falls back to what it did before (the
 * search-based shelves). Callers must treat a rejection as "use the old way".
 */

const enc = encodeURIComponent;
const STALE_MEMO_MS = 60_000;

export interface FeedOpts {
  signal?: AbortSignal;
  priority?: RequestPriority;
}

/** Languages the API accepts in its `language` parameter. */
export const API_LANGUAGES = [
  'hindi', 'english', 'punjabi', 'tamil', 'telugu', 'marathi', 'gujarati', 'bengali',
  'kannada', 'bhojpuri', 'malayalam', 'urdu', 'haryanvi', 'rajasthani', 'odia', 'assamese',
] as const;

/** The listener's languages as the API's comma list; unsupported ones are dropped, hindi when none is left. */
export function languageParam(langs: readonly string[] | string | null | undefined, max = 3): string {
  const list = (Array.isArray(langs) ? langs : typeof langs === 'string' ? langs.split(',') : [])
    .map((l) => String(l).trim().toLowerCase())
    .filter((l): l is (typeof API_LANGUAGES)[number] => (API_LANGUAGES as readonly string[]).includes(l));
  const uniq = [...new Set(list)].slice(0, max);
  return uniq.length ? uniq.join(',') : 'hindi';
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(Math.round(Number(n) || lo), lo), hi);
}

function arr(v: unknown): unknown[] | null {
  return Array.isArray(v) ? v : null;
}

const albums = (v: unknown): Album[] => (arr(v) ?? []).map(normalizeAlbum).filter((a): a is Album => a !== null);
const playlists = (v: unknown): Playlist[] =>
  (arr(v) ?? []).map(normalizePlaylist).filter((p): p is Playlist => p !== null);

function feed<T>(path: string, validate: (d: any) => T | null, opts?: FeedOpts & { timeoutMs?: number }): Promise<T> {
  return orchestratedRequest({
    paths: [path],
    priority: opts?.priority ?? 'background',
    signal: opts?.signal,
    timeoutMs: opts?.timeoutMs,
    cacheMs: STALE_MEMO_MS,
    validate: (json) => validate(unwrap(json)),
  });
}

// ── Trending, new releases, charts, featured playlists, home ────────────────

export interface TrendingFeed {
  songs: Song[];
  albums: Album[];
  playlists: Playlist[];
}

export function getTrending(langs: readonly string[] | string, limit = 20, opts?: FeedOpts): Promise<TrendingFeed> {
  return feed(`/trending?language=${enc(languageParam(langs))}&limit=${clamp(limit, 1, 50)}`, (d) => {
    if (!d || typeof d !== 'object' || (!arr(d.songs) && !arr(d.albums) && !arr(d.playlists))) return null;
    return { songs: normalizeSongList(d.songs), albums: albums(d.albums), playlists: playlists(d.playlists) };
  }, opts);
}

/** One section of the trending feed. Empty lists are a miss, so callers fall back. */
export function getTrendingSongs(langs: readonly string[] | string, limit = 20, opts?: FeedOpts): Promise<Song[]> {
  return feed(`/trending/songs?language=${enc(languageParam(langs))}&limit=${clamp(limit, 1, 50)}`, (d) => {
    const songs = normalizeSongList(arr(d) ?? d?.songs);
    return songs.length ? songs : null;
  }, opts);
}

export function getTrendingAlbums(langs: readonly string[] | string, limit = 20, opts?: FeedOpts): Promise<Album[]> {
  return feed(`/trending/albums?language=${enc(languageParam(langs))}&limit=${clamp(limit, 1, 50)}`, (d) => {
    const list = albums(arr(d) ?? d?.albums);
    return list.length ? list : null;
  }, opts);
}

export function getTrendingPlaylists(langs: readonly string[] | string, limit = 20, opts?: FeedOpts): Promise<Playlist[]> {
  return feed(`/trending/playlists?language=${enc(languageParam(langs))}&limit=${clamp(limit, 1, 50)}`, (d) => {
    const list = playlists(arr(d) ?? d?.playlists);
    return list.length ? list : null;
  }, opts);
}

export interface NewReleasesFeed {
  songs: Song[];
  albums: Album[];
}

export function getNewReleases(langs: readonly string[] | string, limit = 20, opts?: FeedOpts): Promise<NewReleasesFeed> {
  return feed(`/new-releases?language=${enc(languageParam(langs))}&limit=${clamp(limit, 1, 50)}`, (d) => {
    if (!d || typeof d !== 'object') return null;
    const out = { songs: normalizeSongList(d.songs), albums: albums(d.albums) };
    return out.songs.length || out.albums.length ? out : null;
  }, opts);
}

/** The catalogue's chart playlists ("Most Searched Songs - Hindi", "Trending Today"…). */
export function getCharts(langs: readonly string[] | string, limit = 20, opts?: FeedOpts): Promise<Playlist[]> {
  return feed(`/charts?language=${enc(languageParam(langs))}&limit=${clamp(limit, 1, 50)}`, (d) => {
    const list = playlists(d);
    return list.length ? list : null;
  }, opts);
}

export function getFeaturedPlaylists(langs: readonly string[] | string, limit = 20, opts?: FeedOpts): Promise<Playlist[]> {
  return feed(`/featured-playlists?language=${enc(languageParam(langs))}&limit=${clamp(limit, 1, 50)}`, (d) => {
    const list = playlists(d);
    return list.length ? list : null;
  }, opts);
}

export interface HomeFeed {
  newSongs: Song[];
  newAlbums: Album[];
  charts: Playlist[];
  featuredPlaylists: Playlist[];
}

export function getHomeFeed(langs: readonly string[] | string, limit = 12, opts?: FeedOpts): Promise<HomeFeed> {
  return feed(`/home?language=${enc(languageParam(langs))}&limit=${clamp(limit, 1, 50)}`, (d) => {
    if (!d || typeof d !== 'object') return null;
    const out: HomeFeed = {
      newSongs: normalizeSongList(d.newReleases?.songs),
      newAlbums: albums(d.newReleases?.albums),
      charts: playlists(d.charts),
      featuredPlaylists: playlists(d.featuredPlaylists),
    };
    return out.newSongs.length || out.newAlbums.length || out.charts.length || out.featuredPlaylists.length ? out : null;
  }, opts);
}

// ── Moods and genres ────────────────────────────────────────────────────────

export interface BrowseCategory {
  id: string;
  name: string;
  /** "mood", "genre", "occasion"… as the catalogue labels it. */
  category: string | null;
  tags: string[];
  isNew: boolean;
  images: ImageVariant[];
}

function toCategory(raw: any): BrowseCategory | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' || typeof raw.id === 'number' ? String(raw.id) : '';
  const name = typeof raw.name === 'string' ? decodeHtml(raw.name.trim()) : '';
  if (!id || !name) return null;
  return {
    id,
    name,
    category: typeof raw.category === 'string' && raw.category ? raw.category : null,
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t: unknown): t is string => typeof t === 'string') : [],
    isNew: raw.isNew === true,
    images: toImages(raw.image),
  };
}

export function getBrowseCategories(langs: readonly string[] | string, opts?: FeedOpts): Promise<BrowseCategory[]> {
  return feed(`/browse?language=${enc(languageParam(langs))}`, (d) => {
    const list = (arr(d) ?? []).map(toCategory).filter((c): c is BrowseCategory => c !== null);
    return list.length ? list : null;
  }, opts);
}

export interface BrowseDetail extends BrowseCategory {
  description: string | null;
  playlists: Playlist[];
  songs: Song[];
}

export function getBrowseCategory(id: string, langs: readonly string[] | string, limit = 10, opts?: FeedOpts): Promise<BrowseDetail> {
  return feed(`/browse/${enc(id)}?language=${enc(languageParam(langs))}&limit=${clamp(limit, 1, 10)}`, (d) => {
    const base = toCategory(d);
    if (!base) return null;
    const out: BrowseDetail = {
      ...base,
      description: typeof d.description === 'string' && d.description ? decodeHtml(d.description) : null,
      playlists: playlists(d.playlists),
      songs: normalizeSongList(d.songs),
    };
    return out.playlists.length || out.songs.length ? out : null;
  }, opts);
}

// ── Radio ───────────────────────────────────────────────────────────────────

export interface RadioStation {
  name: string;
  description: string | null;
  language: string;
  color: string | null;
  images: ImageVariant[];
}

export interface RadioSession {
  /** Null when the catalogue could not open a station (songs may still be there). */
  stationId: string | null;
  songs: Song[];
}

export function getRadioStations(langs: readonly string[] | string, opts?: FeedOpts): Promise<RadioStation[]> {
  return feed(`/radio?language=${enc(languageParam(langs))}`, (d) => {
    const list: RadioStation[] = [];
    for (const r of arr(d) ?? []) {
      const raw = r as any;
      const name = typeof raw?.name === 'string' ? raw.name.trim() : '';
      if (!name) continue;
      list.push({
        name,
        description: typeof raw.description === 'string' && raw.description ? decodeHtml(raw.description) : null,
        language: typeof raw.language === 'string' && raw.language ? raw.language : 'hindi',
        color: typeof raw.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(raw.color) ? raw.color : null,
        images: toImages(raw.image),
      });
    }
    return list.length ? list : null;
  }, opts);
}

function radioSession(d: any): RadioSession | null {
  if (!d || typeof d !== 'object') return null;
  const songs = normalizeSongList(d.songs);
  if (!songs.length) return null;
  return { stationId: typeof d.stationId === 'string' && d.stationId ? d.stationId : null, songs };
}

/** Radio calls are never memoised: every call starts or advances a station. */
function radio<T>(path: string, validate: (d: any) => T | null, opts?: FeedOpts): Promise<T> {
  return orchestratedRequest({
    paths: [path],
    priority: opts?.priority ?? 'interactive',
    signal: opts?.signal,
    validate: (json) => validate(unwrap(json)),
  });
}

export function startFeaturedStation(name: string, language: string, limit = 15, opts?: FeedOpts): Promise<RadioSession> {
  return radio(
    `/radio/featured?name=${enc(name)}&language=${enc(languageParam(language, 1))}&limit=${clamp(limit, 1, 30)}`,
    radioSession,
    opts,
  );
}

export function startArtistRadio(artistId: string, limit = 15, opts?: FeedOpts): Promise<RadioSession> {
  return radio(`/artists/${enc(artistId)}/radio?limit=${clamp(limit, 1, 30)}`, radioSession, opts);
}

/** The next songs on a station opened by startFeaturedStation / startArtistRadio. */
export function nextStationSongs(stationId: string, limit = 10, opts?: FeedOpts): Promise<Song[]> {
  return radio(`/radio/songs?stationId=${enc(stationId)}&limit=${clamp(limit, 1, 30)}`, (d) => {
    const songs = normalizeSongList(arr(d) ?? d?.songs);
    return songs.length ? songs : null;
  }, { priority: 'background', ...opts });
}

// ── Similar albums and artists ──────────────────────────────────────────────

export function getSimilarArtists(artistId: string, limit = 12, opts?: FeedOpts): Promise<ArtistRef[]> {
  return feed(`/artists/${enc(artistId)}/similar?limit=${clamp(limit, 1, 50)}`, (d) => {
    const out: ArtistRef[] = [];
    for (const r of arr(d) ?? []) {
      const raw = r as any;
      const id = raw?.id != null ? String(raw.id) : '';
      const name = typeof raw?.name === 'string' ? decodeHtml(raw.name) : '';
      if (!id || !name) continue;
      const imgs = toImages(raw.image);
      out.push({ id, name, image: imgs.length ? imgs[imgs.length - 1].url : null });
    }
    return out.length ? out : null;
  }, opts);
}

export function getSimilarAlbums(albumId: string, limit = 12, opts?: FeedOpts): Promise<Album[]> {
  return feed(`/albums/${enc(albumId)}/similar?limit=${clamp(limit, 1, 50)}`, (d) => {
    const list = albums(d);
    return list.length ? list : null;
  }, opts);
}

// ── Top searches ────────────────────────────────────────────────────────────

export interface TopSearch {
  id: string;
  name: string;
  type: 'song' | 'album' | 'artist' | 'playlist';
  explicit: boolean;
  images: ImageVariant[];
}

export function getTopSearches(langs: readonly string[] | string, opts?: FeedOpts): Promise<TopSearch[]> {
  return feed(`/search/top?language=${enc(languageParam(langs))}`, (d) => {
    const out: TopSearch[] = [];
    for (const r of arr(d) ?? []) {
      const raw = r as any;
      const type = raw?.type;
      if (type !== 'song' && type !== 'album' && type !== 'artist' && type !== 'playlist') continue;
      const id = raw.id != null ? String(raw.id) : '';
      const name = typeof raw.name === 'string' ? decodeHtml(raw.name) : '';
      if (!id || !name) continue;
      out.push({ id, name, type, explicit: raw.explicitContent === true, images: toImages(raw.image) });
    }
    return out.length ? out : null;
  }, opts);
}

// ── Podcasts ────────────────────────────────────────────────────────────────

export interface PodcastSummary {
  id: string;
  name: string;
  season: number | null;
  releaseDate: string | null;
  explicit: boolean;
  images: ImageVariant[];
}

export interface PodcastSeason {
  id: string;
  name: string;
  number: number | null;
  episodeCount: number | null;
}

export interface Podcast {
  id: string;
  name: string;
  description: string | null;
  language: string | null;
  hosts: ArtistRef[];
  followerCount: number | null;
  images: ImageVariant[];
  seasons: PodcastSeason[];
  episodes: Song[];
}

const numOrNull = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

function toSummary(raw: any): PodcastSummary | null {
  const id = raw?.id != null ? String(raw.id) : '';
  const name = typeof raw?.name === 'string' ? decodeHtml(raw.name) : '';
  if (!id || !name) return null;
  return {
    id,
    name,
    season: numOrNull(raw.season),
    releaseDate: typeof raw.releaseDate === 'string' ? raw.releaseDate : null,
    explicit: raw.explicitContent === true,
    images: toImages(raw.image),
  };
}

/**
 * An episode as a playable Song. Episodes carry `artists` as a flat list and
 * a single `original` audio file; the podcast name stands in for the album
 * so the player's subtitle reads "Host · Podcast".
 */
export function episodeToSong(raw: any): Song | null {
  const id = raw?.id != null ? String(raw.id) : '';
  const title = typeof raw?.name === 'string' ? decodeHtml(raw.name) : '';
  if (!id || !title) return null;
  const artists: ArtistRef[] = (arr(raw.artists) ?? [])
    .map((a: any) => ({ id: a?.id != null ? String(a.id) : '', name: typeof a?.name === 'string' ? decodeHtml(a.name) : '' }))
    .filter((a) => a.name);
  const audio = toAudio(raw.downloadUrl);
  if (!audio.length) return null;
  const show = typeof raw.podcast?.name === 'string' ? decodeHtml(raw.podcast.name) : '';
  return {
    kind: 'song',
    id,
    title,
    subtitle: artists.map((a) => a.name).join(', ') || show,
    artists,
    album: show ? { id: raw.podcast?.id != null ? String(raw.podcast.id) : '', name: show } : null,
    images: toImages(raw.image),
    audio,
    duration: numOrNull(raw.duration),
    language: typeof raw.language === 'string' ? raw.language.toLowerCase() : null,
    year: typeof raw.releaseDate === 'string' ? raw.releaseDate.slice(0, 4) || null : null,
    explicit: raw.explicitContent === true,
    hasLyrics: false,
    playCount: numOrNull(raw.playCount),
  };
}

const episodes = (v: unknown): Song[] => (arr(v) ?? []).map(episodeToSong).filter((s): s is Song => s !== null);

export function getPodcasts(page = 1, limit = 20, opts?: FeedOpts): Promise<PodcastSummary[]> {
  return feed(`/podcasts?page=${clamp(page, 1, 500)}&limit=${clamp(limit, 1, 50)}`, (d) => {
    const list = arr(d);
    if (!list) return null;
    // Past page 1 an empty list is the end, not a miss.
    const out = list.map(toSummary).filter((p): p is PodcastSummary => p !== null);
    return out.length || page > 1 ? out : null;
  }, opts);
}

export function getPodcast(id: string, season?: number | null, opts?: FeedOpts): Promise<Podcast> {
  const s = season != null ? `?season=${clamp(season, 1, 1000)}` : '';
  return feed(`/podcasts/${enc(id)}${s}`, (d) => {
    const sum = toSummary(d);
    if (!sum) return null;
    const seasons: PodcastSeason[] = (arr(d.seasons) ?? [])
      .map((r: any) => ({
        id: r?.id != null ? String(r.id) : '',
        name: typeof r?.name === 'string' ? decodeHtml(r.name) : '',
        number: numOrNull(r?.number),
        episodeCount: numOrNull(r?.episodeCount),
      }))
      .filter((r) => r.id || r.number != null);
    return {
      id: sum.id,
      name: sum.name,
      description: typeof d.description === 'string' && d.description ? decodeHtml(d.description) : null,
      language: typeof d.language === 'string' ? d.language : null,
      hosts: (arr(d.hosts) ?? [])
        .map((h: any) => ({ id: h?.id != null ? String(h.id) : '', name: typeof h?.name === 'string' ? decodeHtml(h.name) : '' }))
        .filter((h) => h.name),
      followerCount: numOrNull(d.followerCount),
      images: sum.images,
      seasons,
      episodes: episodes(d.episodes),
    };
  }, opts);
}

/** One page of a season's episodes (1-based). An empty list is the last page. */
export function getPodcastEpisodes(
  id: string,
  { season, page = 1, limit = 20 }: { season?: number | null; page?: number; limit?: number } = {},
  opts?: FeedOpts,
): Promise<Song[]> {
  const s = season != null ? `&season=${clamp(season, 1, 1000)}` : '';
  return feed(`/podcasts/${enc(id)}/episodes?page=${clamp(page, 1, 1000)}&limit=${clamp(limit, 1, 50)}${s}`, (d) => {
    const list = arr(d);
    return list ? episodes(list) : null;
  }, opts);
}
