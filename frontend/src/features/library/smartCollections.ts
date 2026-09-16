import type { HistoryEntry, Song } from '@/types';
import { normalizeText, primaryArtist } from './duplicates';

/**
 * v6.1.0 — Smart collections: saved RULES over the local library instead of
 * a fixed song list. A rule set is evaluated live against the songs this
 * device already knows (favourites, playlists, Listen Later, history), so a
 * smart collection is only ever as complete as the local metadata — it never
 * searches the catalogue. Definitions are versioned so a future rule shape
 * can migrate old ones instead of dropping them, and they travel in backups.
 */
export const SMART_RULES_VERSION = 1 as const;
export const SMART_COLLECTIONS_KEY = 'vinax.smart-collections.v1';
export const SMART_MAX = 100;

export type SmartSort = 'recent' | 'title' | 'artist' | 'duration' | 'newest' | 'plays';

export interface SmartRules {
  /** Any of these languages (song.language ids). Empty = any. */
  languages: string[];
  /** Any of these artists (case/accent-insensitive contains). Empty = any. */
  artists: string[];
  /** Seconds; null = no bound. */
  minDuration: number | null;
  maxDuration: number | null;
  /** Only songs in favourites. */
  favoritesOnly: boolean;
  /** Played within the last N days; null = no rule. */
  playedWithinDays: number | null;
  /** Never played on this device. */
  neverPlayed: boolean;
  /** Release year bounds; null = no bound. */
  yearFrom: number | null;
  yearTo: number | null;
  /** Free-text words that must all appear in title / artist / album. */
  text: string;
}

export interface SmartCollection {
  id: string;
  name: string;
  createdAt: number;
  version: typeof SMART_RULES_VERSION;
  rules: SmartRules;
  sort: SmartSort;
  /** 0 = unlimited. */
  limit: number;
  emoji?: string;
}

export const EMPTY_RULES: SmartRules = {
  languages: [],
  artists: [],
  minDuration: null,
  maxDuration: null,
  favoritesOnly: false,
  playedWithinDays: null,
  neverPlayed: false,
  yearFrom: null,
  yearTo: null,
  text: '',
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const strList = (v: unknown, max = 20): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim().slice(0, 80)).slice(0, max) : []);
const numOrNull = (v: unknown, min: number, max: number): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : null);
const SORTS: SmartSort[] = ['recent', 'title', 'artist', 'duration', 'newest', 'plays'];

export function sanitizeRules(raw: unknown): SmartRules {
  const r = isObj(raw) ? raw : {};
  return {
    languages: strList(r.languages).map((l) => l.toLowerCase()),
    artists: strList(r.artists),
    minDuration: numOrNull(r.minDuration, 0, 24 * 3600),
    maxDuration: numOrNull(r.maxDuration, 0, 24 * 3600),
    favoritesOnly: r.favoritesOnly === true,
    playedWithinDays: numOrNull(r.playedWithinDays, 1, 3650),
    neverPlayed: r.neverPlayed === true,
    yearFrom: numOrNull(r.yearFrom, 1900, 2100),
    yearTo: numOrNull(r.yearTo, 1900, 2100),
    text: typeof r.text === 'string' ? r.text.trim().slice(0, 80) : '',
  };
}

/**
 * Accept any stored definition and bring it to the current shape. Unknown
 * versions are treated as v1 with the fields we recognise; a definition
 * without an id or name is dropped (returns null).
 */
export function migrateSmartCollection(raw: unknown): SmartCollection | null {
  if (!isObj(raw)) return null;
  const id = typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 64) : null;
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 80) : null;
  if (!id || !name) return null;
  const out: SmartCollection = {
    id,
    name,
    createdAt: typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
    version: SMART_RULES_VERSION,
    rules: sanitizeRules(raw.rules),
    sort: SORTS.includes(raw.sort as SmartSort) ? (raw.sort as SmartSort) : 'recent',
    limit: numOrNull(raw.limit, 0, 1000) ?? 0,
  };
  const emoji = typeof raw.emoji === 'string' ? raw.emoji.trim().slice(0, 8) : '';
  if (emoji) out.emoji = emoji;
  return out;
}

export function sanitizeSmartCollections(raw: unknown): SmartCollection[] {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const out: SmartCollection[] = [];
  for (const item of list) {
    const c = migrateSmartCollection(item);
    if (!c || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
    if (out.length >= SMART_MAX) break;
  }
  return out;
}

/** Everything the device knows about, de-duplicated by song id. */
export interface LocalLibrarySources {
  favorites: Song[];
  collections: Array<{ songs: Song[] }>;
  later: Song[];
  history: HistoryEntry[];
}

export interface LocalSong {
  song: Song;
  favorite: boolean;
  lastPlayedTs: number | null;
  plays: number;
}

export function collectLocalSongs(src: LocalLibrarySources): LocalSong[] {
  const map = new Map<string, LocalSong>();
  const upsert = (song: Song, patch: Partial<LocalSong>): void => {
    if (!song?.id) return;
    const cur = map.get(song.id) ?? { song, favorite: false, lastPlayedTs: null, plays: 0 };
    map.set(song.id, { ...cur, ...patch, song: cur.song });
  };
  for (const s of src.favorites) upsert(s, { favorite: true });
  for (const c of src.collections) for (const s of c.songs) upsert(s, {});
  for (const s of src.later) upsert(s, {});
  for (const e of src.history) {
    if (!e?.song || typeof e.ts !== 'number') continue;
    const cur = map.get(e.song.id);
    upsert(e.song, {
      plays: (cur?.plays ?? 0) + 1,
      lastPlayedTs: Math.max(cur?.lastPlayedTs ?? 0, e.ts) || e.ts,
    });
  }
  return [...map.values()];
}

const yearOf = (s: Song): number | null => {
  const n = Number.parseInt(s.year ?? '', 10);
  return Number.isFinite(n) ? n : null;
};

export function matchesRules(item: LocalSong, rules: SmartRules, now = Date.now()): boolean {
  const { song } = item;
  if (rules.languages.length && !(song.language && rules.languages.includes(song.language.toLowerCase()))) return false;
  if (rules.artists.length) {
    const credits = normalizeText(`${song.subtitle} ${song.artists.map((a) => a.name).join(' ')}`);
    if (!rules.artists.some((a) => credits.includes(normalizeText(a)))) return false;
  }
  if (rules.minDuration !== null && !(typeof song.duration === 'number' && song.duration >= rules.minDuration)) return false;
  if (rules.maxDuration !== null && !(typeof song.duration === 'number' && song.duration <= rules.maxDuration)) return false;
  if (rules.favoritesOnly && !item.favorite) return false;
  if (rules.playedWithinDays !== null && !(item.lastPlayedTs !== null && now - item.lastPlayedTs <= rules.playedWithinDays * 86_400_000)) return false;
  if (rules.neverPlayed && item.plays > 0) return false;
  const y = yearOf(song);
  if (rules.yearFrom !== null && !(y !== null && y >= rules.yearFrom)) return false;
  if (rules.yearTo !== null && !(y !== null && y <= rules.yearTo)) return false;
  if (rules.text) {
    const hay = normalizeText(`${song.title} ${song.subtitle} ${song.artists.map((a) => a.name).join(' ')} ${song.album?.name ?? ''}`);
    if (!normalizeText(rules.text).split(' ').every((w) => hay.includes(w))) return false;
  }
  return true;
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

export function sortLocalSongs(items: LocalSong[], sort: SmartSort): LocalSong[] {
  const list = [...items];
  switch (sort) {
    case 'title':
      return list.sort((a, b) => collator.compare(a.song.title, b.song.title));
    case 'artist':
      return list.sort((a, b) => collator.compare(primaryArtist(a.song), primaryArtist(b.song)) || collator.compare(a.song.title, b.song.title));
    case 'duration':
      return list.sort((a, b) => (b.song.duration ?? 0) - (a.song.duration ?? 0));
    case 'newest':
      return list.sort((a, b) => (yearOf(b.song) ?? 0) - (yearOf(a.song) ?? 0));
    case 'plays':
      return list.sort((a, b) => b.plays - a.plays || (b.lastPlayedTs ?? 0) - (a.lastPlayedTs ?? 0));
    default:
      // Most recently played first; songs never played on this device keep
      // their library order at the end (the library stores no "added" time).
      return list.sort((a, b) => (b.lastPlayedTs ?? 0) - (a.lastPlayedTs ?? 0));
  }
}

/** Evaluate one smart collection against the local library. */
export function evaluateSmartCollection(def: Pick<SmartCollection, 'rules' | 'sort' | 'limit'>, src: LocalLibrarySources, now = Date.now()): Song[] {
  const items = collectLocalSongs(src).filter((i) => matchesRules(i, def.rules, now));
  const sorted = sortLocalSongs(items, def.sort).map((i) => i.song);
  return def.limit > 0 ? sorted.slice(0, def.limit) : sorted;
}

/** Plain-language summary of a rule set ("Telugu · favourites · played in 30 days"). */
export function describeRules(rules: SmartRules, languageLabel: (id: string) => string = (id) => id): string {
  const parts: string[] = [];
  if (rules.languages.length) parts.push(rules.languages.map(languageLabel).join(' / '));
  if (rules.artists.length) parts.push(rules.artists.join(', '));
  if (rules.favoritesOnly) parts.push('favourites');
  if (rules.playedWithinDays !== null) parts.push(`played in ${rules.playedWithinDays} day${rules.playedWithinDays === 1 ? '' : 's'}`);
  if (rules.neverPlayed) parts.push('never played');
  if (rules.minDuration !== null || rules.maxDuration !== null) {
    const f = (s: number) => `${Math.round(s / 60)} min`;
    parts.push(rules.minDuration !== null && rules.maxDuration !== null ? `${f(rules.minDuration)}–${f(rules.maxDuration)}` : rules.minDuration !== null ? `over ${f(rules.minDuration)}` : `under ${f(rules.maxDuration as number)}`);
  }
  if (rules.yearFrom !== null || rules.yearTo !== null) parts.push(rules.yearFrom !== null && rules.yearTo !== null ? `${rules.yearFrom}–${rules.yearTo}` : rules.yearFrom !== null ? `from ${rules.yearFrom}` : `up to ${rules.yearTo}`);
  if (rules.text) parts.push(`“${rules.text}”`);
  return parts.join(' · ') || 'Every song in your library';
}
