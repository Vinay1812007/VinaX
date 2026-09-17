import { KEYS } from '@/constants/storage-keys';
import { LATEST_VERSION } from '@/constants/version';
import { getLocal, setLocal, writeLocalBatch, type StorageFailure } from '@/services/storage/local';
import { HOME_DESIGN_KEY, validateHomeDesign } from '@/services/recommendation/homeDesign';
import { pruneTrash, type TrashEntry } from '@/features/library/trash';
import { normalizeTags } from '@/features/library/tags';
import { USERNAME_RE } from '@/features/identity/handleClaim';
import { SMART_COLLECTIONS_KEY, sanitizeSmartCollections } from '@/features/library/smartCollections';
import { normalizeProfile } from '@/services/personalization/profile';
import { sanitizeAlarm, sanitizeLyricOffsets } from '@/services/storage/sanitize';
import { pickSettings, useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useSmartCollectionStore } from '@/store/smartCollectionStore';
import { useHistoryStore } from '@/store/historyStore';
import { useSearchStore } from '@/store/searchStore';
import { useSearchWorkspaceStore } from '@/store/searchWorkspaceStore';
import { useBookmarkStore } from '@/store/bookmarkStore';
import { useAlarmStore } from '@/store/alarmStore';
import { useLyricsOffsetStore } from '@/store/lyricsOffsetStore';
import type { HistoryEntry, Song } from '@/types';

/**
 * Versioned, portable backup of the listener's own data.
 *
 * v1 (the old "export profile") dumped EVERY registry key — including the
 * service-issued device token, Listen Together host keys and Android
 * download paths — and imported anything back without looking at it. This
 * schema separates what travels (preferences, library, history, taste,
 * saved searches, bookmarks, Home layout, identity choices) from what must
 * not (credentials, device identity, caches, device-specific file paths),
 * validates every category before a single key is written, migrates the
 * old file shape, and applies restores all-or-nothing with rollback.
 *
 * The file:
 *   { format: 'vinax-backup', schemaVersion: 2, app: 'vinax', appVersion,
 *     exportedAt, categories: { <id>: { <storageKey>: <value> } } }
 */
export const BACKUP_FORMAT = 'vinax-backup';
export const BACKUP_SCHEMA_VERSION = 2 as const;
export const BACKUP_META_KEY = 'vinax.backup.meta.v1';
export const MAX_BACKUP_BYTES = 8 * 1024 * 1024;

const SEARCH_WORKSPACE_KEY = 'vinax.search.workspace.v1';
const BOOKMARKS_KEY = 'vinax.bookmarks.v1';
const STREAK_KEY = 'vinax.streak.v1';
const NAV_GROUPS_KEY = 'vinax.nav.groups.v1';
const SAVED_PROMPTS_KEY = 'vinax.aiPrompts';
export { SMART_COLLECTIONS_KEY };

export type BackupCategoryId =
  | 'settings'
  | 'library'
  | 'smartCollections'
  | 'history'
  | 'taste'
  | 'searches'
  | 'bookmarks'
  | 'homeLayout'
  | 'identity'
  | 'extras'
  | 'aiChats';

/** One storage key inside a category. `raw` keys hold a bare string, not JSON. */
interface KeySpec {
  key: string;
  raw?: boolean;
}

export type CategoryValues = Record<string, unknown>;

/** How a sanitize pass should treat size caps, and where to report a cut. */
export interface SanitizeContext {
  /**
   * Reading THIS device's own data for a merge: nothing is cut. A cap exists
   * to bound what a file can bring in — applying it to what the listener
   * already has would silently drop their data before the merge even starts.
   */
  uncapped?: boolean;
  /** Called when a cap cut a list short, so the preview can say so. */
  warn?(message: string): void;
}

export interface BackupCategory {
  id: BackupCategoryId;
  label: string;
  /** What a listener would recognise inside it. */
  description: string;
  keys: KeySpec[];
  /** Cleans a category's values; returns an error message when the SHAPE is wrong. */
  sanitize(values: CategoryValues, ctx?: SanitizeContext): { values: CategoryValues } | { error: string };
  /** Human summary of what a (sanitized) category holds, for previews. */
  summarize(values: CategoryValues): string;
  /** Union an incoming category into the current one (used by merge restores). */
  merge?(current: CategoryValues, incoming: CategoryValues): CategoryValues;
}

// ---------------------------------------------------------------- helpers --
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max = 500): string | null => (typeof v === 'string' ? v.slice(0, max) : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
/** Only web URLs travel: no `javascript:`, `data:`, `file:` or device paths; over-long strings are dropped, not cut. */
const httpUrl = (v: unknown, max = 2000): string | null => (typeof v === 'string' && v.length <= max && /^https?:\/\//i.test(v) ? v : null);

/** Apply a size cap — unless reading the device's own data — and report a cut. */
function capped<T>(list: T[], max: number, what: string, ctx?: SanitizeContext): T[] {
  if (ctx?.uncapped || list.length <= max) return list;
  ctx?.warn?.(`${what}: the file holds ${list.length}, only the first ${max} can be restored.`);
  return list.slice(0, max);
}

/** A song that will not crash any screen: id + title are mandatory, the rest is defaulted. */
export function sanitizeSong(v: unknown): Song | null {
  if (!isObj(v)) return null;
  const id = str(v.id, 128);
  const title = str(v.title, 300);
  if (!id || !title) return null;
  const variants = (list: unknown): Array<{ quality: string; url: string }> =>
    Array.isArray(list)
      ? list
          .filter(isObj)
          .map((x) => ({ quality: str(x.quality, 40) ?? '', url: httpUrl(x.url) ?? '' }))
          .filter((x) => x.url)
      : [];
  const artists = Array.isArray(v.artists)
    ? v.artists
        .filter(isObj)
        .map((a) => ({
          id: str(a.id, 128) ?? '',
          name: str(a.name, 200) ?? '',
          ...(str(a.role, 40) ? { role: str(a.role, 40) as string } : {}),
          ...(typeof a.image === 'string' || a.image === null ? { image: httpUrl(a.image) } : {}),
        }))
        .filter((a) => a.name)
    : [];
  const album = isObj(v.album) && str(v.album.id, 128) ? { id: str(v.album.id, 128) as string, name: str(v.album.name, 300) ?? '' } : null;
  const song: Song = {
    kind: 'song',
    id,
    title,
    subtitle: str(v.subtitle, 400) ?? '',
    artists,
    album,
    images: variants(v.images),
    audio: variants(v.audio),
    duration: num(v.duration),
    language: str(v.language, 40),
    year: str(v.year, 12),
    explicit: v.explicit === true,
    hasLyrics: v.hasLyrics === true,
    playCount: num(v.playCount),
  };
  for (const opt of ['dialect', 'subLanguage', 'genre', 'vibe', 'mood'] as const) {
    const val = str(v[opt], 80);
    if (val) song[opt] = val;
  }
  for (const opt of ['genres', 'vibes'] as const) {
    if (Array.isArray(v[opt])) song[opt] = (v[opt] as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 20);
  }
  for (const opt of ['energy', 'tempo'] as const) {
    const val = num(v[opt]);
    if (val !== null) song[opt] = val;
  }
  return song;
}

const songList = (v: unknown, cap: number, what: string, ctx?: SanitizeContext): Song[] =>
  Array.isArray(v) ? capped(v.map(sanitizeSong).filter((s): s is Song => !!s), cap, what, ctx) : [];

const uniqueById = <T extends { id: string }>(items: T[]): T[] => {
  const seen = new Set<string>();
  return items.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
};

/** zustand persist envelope: { state, version }. */
function envelope(v: unknown): { state: Record<string, unknown>; version: number } | null {
  if (!isObj(v) || !isObj(v.state)) return null;
  return { state: v.state, version: num(v.version) ?? 0 };
}
const wrap = (state: Record<string, unknown>, version: number) => ({ state, version });

/**
 * The persist version each envelope is written with. The FILE's number is
 * never trusted: sanitize already produced the current shape, and a version
 * the running store does not expect makes it discard the whole record (no
 * migrate) or skip/rerun migrations. Read lazily from the stores themselves
 * so this cannot drift from their `version:` option.
 */
const STORE_VERSIONS: Record<string, () => number | undefined> = {
  [KEYS.settings]: () => useSettingsStore.persist.getOptions().version,
  [KEYS.library]: () => useLibraryStore.persist.getOptions().version,
  [SMART_COLLECTIONS_KEY]: () => useSmartCollectionStore.persist.getOptions().version,
  [KEYS.history]: () => useHistoryStore.persist.getOptions().version,
  [KEYS.search]: () => useSearchStore.persist.getOptions().version,
  [SEARCH_WORKSPACE_KEY]: () => useSearchWorkspaceStore.persist.getOptions().version,
  [BOOKMARKS_KEY]: () => useBookmarkStore.persist.getOptions().version,
  [KEYS.alarm]: () => useAlarmStore.persist.getOptions().version,
  [KEYS.lyricsOffset]: () => useLyricsOffsetStore.persist.getOptions().version,
};
export const storeVersion = (key: string): number => STORE_VERSIONS[key]?.() ?? 0;
/** Settings alone keep an OLDER file version (never a newer one) so the store's migrate still runs on it. */
const settingsVersion = (fileVersion: number): number => Math.max(0, Math.min(Math.floor(fileVersion), storeVersion(KEYS.settings)));

interface Collection {
  id: string;
  name: string;
  createdAt: number;
  songs: Song[];
  pinned?: boolean;
  description?: string;
  emoji?: string;
  tags?: string[];
}

function sanitizeCollection(v: unknown, ctx?: SanitizeContext): Collection | null {
  if (!isObj(v)) return null;
  const id = str(v.id, 64);
  const name = str(v.name, 120);
  if (!id || !name) return null;
  const c: Collection = { id, name, createdAt: num(v.createdAt) ?? Date.now(), songs: songList(v.songs, 2000, `Playlist "${name}"`, ctx) };
  if (v.pinned === true) c.pinned = true;
  const d = str(v.description, 280);
  if (d) c.description = d;
  const e = str(v.emoji, 8);
  if (e) c.emoji = e;
  if (Array.isArray(v.tags)) {
    const tags = normalizeTags(v.tags.filter((t): t is string => typeof t === 'string'));
    if (tags.length) c.tags = tags;
  }
  return c;
}

function sanitizeHistoryEntry(v: unknown): HistoryEntry | null {
  if (!isObj(v)) return null;
  const song = sanitizeSong(v.song);
  const ts = num(v.ts);
  if (!song || ts === null) return null;
  const entry: HistoryEntry = { song, ts, completed: v.completed === true };
  // Measured listening time (stats, calendar, weekly report) — without it a
  // restored history falls back to estimates. Capped at six hours per play.
  const listened = num(v.listenedSec);
  if (listened !== null && listened >= 0) entry.listenedSec = Math.min(listened, MAX_LISTENED_SEC);
  // v7.0.0 — the explicit skip mark travels only as a real boolean.
  if (v.skipped === true || v.skipped === false) entry.skipped = v.skipped;
  return entry;
}

const HISTORY_CAP = 150;
const MAX_LISTENED_SEC = 21_600;

// ------------------------------------------------------------- categories --
const settingsCategory: BackupCategory = {
  id: 'settings',
  label: 'Settings & preferences',
  description: 'Theme, accent, playback, sound, languages, accessibility and recommendation choices.',
  keys: [{ key: KEYS.settings }, { key: KEYS.region }],
  sanitize: (values) => {
    const out: CategoryValues = {};
    if (values[KEYS.settings] !== undefined) {
      const env = envelope(values[KEYS.settings]);
      if (!env) return { error: 'Settings are not in the expected shape.' };
      // Only known keys of the right type (store/settingsStore pickSettings).
      // Device-bound bits never travel: the inferred region is re-detected.
      const { inferredRegion: _drop, ...state } = pickSettings(env.state);
      void _drop;
      out[KEYS.settings] = wrap(state, settingsVersion(env.version));
    }
    if (values[KEYS.region] !== undefined) {
      if (values[KEYS.region] !== null && !isObj(values[KEYS.region])) return { error: 'Region preference is malformed.' };
      out[KEYS.region] = values[KEYS.region];
    }
    return { values: out };
  },
  summarize: (values) => {
    const env = envelope(values[KEYS.settings]);
    if (!env) return 'No settings';
    const s = env.state;
    const langs = Array.isArray(s.pinnedLanguages) ? s.pinnedLanguages.length : 0;
    return `${Object.keys(s).length} preferences · ${langs} pinned language${langs === 1 ? '' : 's'}`;
  },
};

const libraryCategory: BackupCategory = {
  id: 'library',
  label: 'Library',
  description: 'Favourites, playlists (with tags, pins and descriptions), Listen Later, saved albums/artists and hidden songs.',
  keys: [{ key: KEYS.library }],
  sanitize: (values, ctx) => {
    const env = envelope(values[KEYS.library]);
    if (!env) return { error: 'Library data is not in the expected shape.' };
    const s = env.state;
    for (const field of ['favorites', 'collections', 'saved', 'hiddenSongIds', 'later', 'hiddenArtists']) {
      if (s[field] !== undefined && !Array.isArray(s[field])) return { error: `Library field "${field}" is not a list.` };
    }
    const strings = (x: unknown): string[] => (Array.isArray(x) ? x : []).filter((v): v is string => typeof v === 'string');
    // Trashed playlists are restorable as-is, so they get the same cleaning as live ones.
    const trash = (Array.isArray(s.trash) ? s.trash : [])
      .filter(isObj)
      .map((t) => ({ collection: sanitizeCollection(t.collection, ctx), deletedAt: num(t.deletedAt) }))
      .filter((t): t is TrashEntry => !!t.collection && t.deletedAt !== null);
    const state = {
      favorites: uniqueById(songList(s.favorites, 5000, 'Favourites', ctx)),
      collections: uniqueById(capped((Array.isArray(s.collections) ? s.collections : []).map((c) => sanitizeCollection(c, ctx)).filter((c): c is Collection => !!c), 500, 'Playlists', ctx)),
      saved: capped(
        (Array.isArray(s.saved) ? s.saved : [])
          .filter(isObj)
          .map((e) => ({
            id: str(e.id, 128) ?? '',
            kind: e.kind === 'album' || e.kind === 'artist' || e.kind === 'playlist' ? e.kind : null,
            title: str(e.title, 300) ?? '',
            subtitle: str(e.subtitle, 400) ?? '',
            image: httpUrl(e.image),
            savedAt: num(e.savedAt) ?? Date.now(),
          }))
          .filter((e) => e.id && e.kind && e.title),
        2000,
        'Saved albums and artists',
        ctx,
      ),
      hiddenSongIds: capped(strings(s.hiddenSongIds), 500, 'Hidden songs', ctx),
      later: uniqueById(songList(s.later, 500, 'Listen Later', ctx)),
      hiddenArtists: capped(strings(s.hiddenArtists), 500, 'Never-play artists', ctx),
      trash: pruneTrash(trash),
    };
    return { values: { [KEYS.library]: wrap(state, storeVersion(KEYS.library)) } };
  },
  summarize: (values) => {
    const s = envelope(values[KEYS.library])?.state ?? {};
    const cols = Array.isArray(s.collections) ? (s.collections as Collection[]) : [];
    const songs = cols.reduce((n, c) => n + c.songs.length, 0);
    const fav = Array.isArray(s.favorites) ? s.favorites.length : 0;
    const later = Array.isArray(s.later) ? s.later.length : 0;
    return `${fav} favourite${fav === 1 ? '' : 's'} · ${cols.length} playlist${cols.length === 1 ? '' : 's'} (${songs} songs) · ${later} for later`;
  },
  merge: (current, incoming) => {
    const a = envelope(current[KEYS.library]);
    const b = envelope(incoming[KEYS.library]);
    if (!a) return incoming;
    if (!b) return current;
    const A = a.state as Record<string, unknown[]>;
    const B = b.state as Record<string, unknown[]>;
    const list = (x: unknown) => (Array.isArray(x) ? x : []);
    const byId = (x: unknown[], y: unknown[]) => uniqueById([...(x as { id: string }[]), ...(y as { id: string }[])]);
    const colsA = list(A.collections) as Collection[];
    const colsB = list(B.collections) as Collection[];
    const collections = colsA.map((c) => {
      const twin = colsB.find((d) => d.id === c.id);
      return twin ? { ...c, songs: uniqueById([...c.songs, ...twin.songs]) } : c;
    });
    for (const d of colsB) if (!collections.some((c) => c.id === d.id)) collections.push(d);
    const strs = (x: unknown[], y: unknown[]) => [...new Set([...(x as string[]), ...(y as string[])])];
    const saved = [...(list(A.saved) as { id: string; kind: string }[])];
    for (const e of list(B.saved) as { id: string; kind: string }[]) if (!saved.some((s) => s.id === e.id && s.kind === e.kind)) saved.push(e);
    return {
      [KEYS.library]: wrap(
        {
          favorites: byId(list(A.favorites), list(B.favorites)),
          collections,
          saved,
          // Ceilings bound what a file can ADD; they never drop below what this device already holds.
          hiddenSongIds: strs(list(A.hiddenSongIds), list(B.hiddenSongIds)).slice(0, Math.max(500, list(A.hiddenSongIds).length)),
          later: byId(list(A.later), list(B.later)).slice(0, Math.max(500, list(A.later).length)),
          hiddenArtists: strs(list(A.hiddenArtists), list(B.hiddenArtists)).slice(0, Math.max(500, list(A.hiddenArtists).length)),
          trash: list(A.trash),
        },
        storeVersion(KEYS.library),
      ),
    };
  },
};

const smartCollectionsCategory: BackupCategory = {
  id: 'smartCollections',
  label: 'Smart collections',
  description: 'Saved rules that build playlists from your local library.',
  keys: [{ key: SMART_COLLECTIONS_KEY }],
  sanitize: (values) => {
    const v = values[SMART_COLLECTIONS_KEY];
    if (v === undefined) return { values: {} };
    const env = envelope(v);
    if (!env || (env.state.rules !== undefined && !Array.isArray(env.state.rules))) return { error: 'Smart collections are not in the expected shape.' };
    // Definitions are migrated to the current rule version on the way in.
    const rules = sanitizeSmartCollections(env.state.rules);
    return { values: { [SMART_COLLECTIONS_KEY]: wrap({ rules }, storeVersion(SMART_COLLECTIONS_KEY)) } };
  },
  summarize: (values) => {
    const rules = envelope(values[SMART_COLLECTIONS_KEY])?.state.rules;
    const n = Array.isArray(rules) ? rules.length : 0;
    return `${n} smart collection${n === 1 ? '' : 's'}`;
  },
  merge: (current, incoming) => {
    const a = envelope(current[SMART_COLLECTIONS_KEY]);
    const b = envelope(incoming[SMART_COLLECTIONS_KEY]);
    if (!a) return incoming;
    if (!b) return current;
    const rules = uniqueById([...(a.state.rules as { id: string }[]), ...(b.state.rules as { id: string }[])]).slice(0, 100);
    return { [SMART_COLLECTIONS_KEY]: wrap({ rules }, storeVersion(SMART_COLLECTIONS_KEY)) };
  },
};

const historyCategory: BackupCategory = {
  id: 'history',
  label: 'Listening history',
  description: `Your last ${HISTORY_CAP} plays, with completion marks.`,
  keys: [{ key: KEYS.history }],
  sanitize: (values, ctx) => {
    const env = envelope(values[KEYS.history]);
    if (!env || (env.state.entries !== undefined && !Array.isArray(env.state.entries))) return { error: 'History is not in the expected shape.' };
    const entries = capped((Array.isArray(env.state.entries) ? env.state.entries : []).map(sanitizeHistoryEntry).filter((e): e is HistoryEntry => !!e), HISTORY_CAP, 'Listening history', ctx);
    return { values: { [KEYS.history]: wrap({ entries }, storeVersion(KEYS.history)) } };
  },
  summarize: (values) => {
    const n = (envelope(values[KEYS.history])?.state.entries as unknown[] | undefined)?.length ?? 0;
    return `${n} play${n === 1 ? '' : 's'}`;
  },
  merge: (current, incoming) => {
    const a = envelope(current[KEYS.history]);
    const b = envelope(incoming[KEYS.history]);
    if (!a) return incoming;
    if (!b) return current;
    // The same play on both sides is ONE play: this device's entry is kept,
    // enriched with whichever side measured more of it.
    const byPlay = new Map<string, HistoryEntry>();
    for (const e of [...(a.state.entries as HistoryEntry[]), ...(b.state.entries as HistoryEntry[])]) {
      const id = `${e.ts}|${e.song.id}`;
      const twin = byPlay.get(id);
      if (!twin) {
        byPlay.set(id, e);
        continue;
      }
      const merged: HistoryEntry = { ...twin, completed: twin.completed || e.completed };
      const listened = Math.max(twin.listenedSec ?? -1, e.listenedSec ?? -1);
      if (listened >= 0) merged.listenedSec = listened;
      if (merged.completed) delete merged.skipped;
      else if (twin.skipped === undefined && e.skipped !== undefined) merged.skipped = e.skipped;
      byPlay.set(id, merged);
    }
    const entries = [...byPlay.values()].sort((x, y) => y.ts - x.ts).slice(0, HISTORY_CAP);
    return { [KEYS.history]: wrap({ entries }, storeVersion(KEYS.history)) };
  },
};

const tasteCategory: BackupCategory = {
  id: 'taste',
  label: 'Taste profile',
  description: 'The on-device taste summary (languages, artists, listening hours, taste dials) and the Kid-mode profile.',
  keys: [{ key: KEYS.profile }, { key: KEYS.profileKid }],
  sanitize: (values) => {
    const out: CategoryValues = {};
    for (const key of [KEYS.profile, KEYS.profileKid]) {
      const v = values[key];
      if (v === undefined || v === null) continue;
      if (!isObj(v) || v.version !== 1) return { error: 'Taste profile has an unknown version.' };
      // Every map, histogram, total and id list is coerced to the shape the scorer expects.
      out[key] = normalizeProfile(v);
    }
    return { values: out };
  },
  summarize: (values) => {
    const p = values[KEYS.profile];
    if (!isObj(p)) return 'No taste profile';
    const totals = isObj(p.totals) ? p.totals : {};
    const langs = isObj(p.languages) ? Object.keys(p.languages).length : 0;
    return `${num(totals.plays) ?? 0} plays learned · ${langs} language${langs === 1 ? '' : 's'}${values[KEYS.profileKid] ? ' · Kid-mode profile' : ''}`;
  },
  // Two decayed models cannot be added together honestly; the one that has
  // learned from more plays is kept, per profile (this device wins a tie).
  merge: (current, incoming) => {
    const out: CategoryValues = { ...incoming, ...current };
    const plays = (v: unknown): number => (isObj(v) && isObj(v.totals) ? num(v.totals.plays) ?? 0 : -1);
    for (const key of [KEYS.profile, KEYS.profileKid]) {
      if (current[key] !== undefined && incoming[key] !== undefined) out[key] = plays(current[key]) >= plays(incoming[key]) ? current[key] : incoming[key];
    }
    return out;
  },
};

const searchesCategory: BackupCategory = {
  id: 'searches',
  label: 'Saved & recent searches',
  description: 'Saved search presets, pinned and recent searches, and the compact results preference.',
  keys: [{ key: KEYS.search }, { key: SEARCH_WORKSPACE_KEY }],
  sanitize: (values, ctx) => {
    const out: CategoryValues = {};
    if (values[KEYS.search] !== undefined) {
      const env = envelope(values[KEYS.search]);
      if (!env) return { error: 'Recent searches are not in the expected shape.' };
      const strs = (x: unknown, cap: number, what: string) => (Array.isArray(x) ? capped(x.filter((s): s is string => typeof s === 'string'), cap, what, ctx) : []);
      out[KEYS.search] = wrap(
        { recent: strs(env.state.recent, 50, 'Recent searches'), pinned: strs(env.state.pinned, 5, 'Pinned searches'), songSort: str(env.state.songSort, 20) ?? 'relevance' },
        storeVersion(KEYS.search),
      );
    }
    if (values[SEARCH_WORKSPACE_KEY] !== undefined) {
      const env = envelope(values[SEARCH_WORKSPACE_KEY]);
      if (!env || (env.state.presets !== undefined && !Array.isArray(env.state.presets))) return { error: 'Saved searches are not in the expected shape.' };
      const presets = capped(
        (Array.isArray(env.state.presets) ? env.state.presets : []).filter(isObj).filter((p) => typeof p.id === 'string' && typeof p.name === 'string' && typeof p.query === 'string'),
        20,
        'Saved searches',
        ctx,
      );
      out[SEARCH_WORKSPACE_KEY] = wrap({ compact: env.state.compact === true, presets }, storeVersion(SEARCH_WORKSPACE_KEY));
    }
    return { values: out };
  },
  summarize: (values) => {
    const presets = (envelope(values[SEARCH_WORKSPACE_KEY])?.state.presets as unknown[] | undefined)?.length ?? 0;
    const recent = (envelope(values[KEYS.search])?.state.recent as unknown[] | undefined)?.length ?? 0;
    return `${presets} saved search${presets === 1 ? '' : 'es'} · ${recent} recent`;
  },
  merge: (current, incoming) => {
    const out: CategoryValues = { ...current };
    const a = envelope(current[SEARCH_WORKSPACE_KEY]);
    const b = envelope(incoming[SEARCH_WORKSPACE_KEY]);
    if (a && b) {
      const presets = uniqueById([...(a.state.presets as { id: string }[]), ...(b.state.presets as { id: string }[])]).slice(0, 20);
      out[SEARCH_WORKSPACE_KEY] = wrap({ compact: a.state.compact === true, presets }, storeVersion(SEARCH_WORKSPACE_KEY));
    } else if (b) out[SEARCH_WORKSPACE_KEY] = incoming[SEARCH_WORKSPACE_KEY];
    const c = envelope(current[KEYS.search]);
    const d = envelope(incoming[KEYS.search]);
    if (c && d) {
      const pinned = [...new Set([...(c.state.pinned as string[]), ...(d.state.pinned as string[])])].slice(0, 5);
      const recent = [...new Set([...(c.state.recent as string[]), ...(d.state.recent as string[])])].slice(0, 50);
      out[KEYS.search] = wrap({ recent, pinned, songSort: c.state.songSort }, storeVersion(KEYS.search));
    } else if (d) out[KEYS.search] = incoming[KEYS.search];
    return out;
  },
};

const bookmarksCategory: BackupCategory = {
  id: 'bookmarks',
  label: 'Song bookmarks',
  description: 'Moments you marked inside songs.',
  keys: [{ key: BOOKMARKS_KEY }],
  sanitize: (values, ctx) => {
    const env = envelope(values[BOOKMARKS_KEY]);
    if (!env || (env.state.marks !== undefined && !isObj(env.state.marks))) return { error: 'Bookmarks are not in the expected shape.' };
    const marks: Record<string, number[]> = {};
    for (const [id, list] of Object.entries(isObj(env.state.marks) ? env.state.marks : {})) {
      if (!Array.isArray(list)) continue;
      const secs = capped([...new Set(list.filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0).map(Math.round))].sort((x, y) => x - y), 12, 'Bookmarks on one song', ctx);
      if (secs.length) marks[id.slice(0, 128)] = secs;
    }
    return { values: { [BOOKMARKS_KEY]: wrap({ marks }, storeVersion(BOOKMARKS_KEY)) } };
  },
  summarize: (values) => {
    const marks = envelope(values[BOOKMARKS_KEY])?.state.marks;
    const songs = isObj(marks) ? Object.keys(marks).length : 0;
    const total = isObj(marks) ? Object.values(marks).reduce((n: number, l) => n + (Array.isArray(l) ? l.length : 0), 0) : 0;
    return `${total} bookmark${total === 1 ? '' : 's'} on ${songs} song${songs === 1 ? '' : 's'}`;
  },
  merge: (current, incoming) => {
    const a = envelope(current[BOOKMARKS_KEY]);
    const b = envelope(incoming[BOOKMARKS_KEY]);
    if (!a) return incoming;
    if (!b) return current;
    const marks: Record<string, number[]> = { ...(a.state.marks as Record<string, number[]>) };
    for (const [id, list] of Object.entries(b.state.marks as Record<string, number[]>)) {
      const cur = marks[id] ?? [];
      const merged = [...cur];
      for (const s of list) if (!merged.some((m) => Math.abs(m - s) < 3)) merged.push(s);
      marks[id] = merged.sort((x, y) => x - y).slice(0, 12);
    }
    return { [BOOKMARKS_KEY]: wrap({ marks }, storeVersion(BOOKMARKS_KEY)) };
  },
};

const homeLayoutCategory: BackupCategory = {
  id: 'homeLayout',
  label: 'Home layout',
  description: 'Your shelf order, hidden shelves and headline from Home Studio.',
  keys: [{ key: HOME_DESIGN_KEY }],
  sanitize: (values) => {
    const v = values[HOME_DESIGN_KEY];
    if (v === undefined || v === null) return { values: {} };
    if (!isObj(v)) return { error: 'Home layout is malformed.' };
    return { values: { [HOME_DESIGN_KEY]: validateHomeDesign(v) } };
  },
  summarize: (values) => {
    const v = values[HOME_DESIGN_KEY];
    if (!isObj(v)) return 'Default layout';
    const hidden = Array.isArray(v.hidden) ? v.hidden.length : 0;
    return `Custom order · ${hidden} hidden shelf${hidden === 1 ? '' : 'ves'}`;
  },
  // A layout is one deliberate arrangement, not a list to union: merging keeps this device's.
  merge: (current, incoming) => (current[HOME_DESIGN_KEY] !== undefined ? current : incoming),
};

const identityCategory: BackupCategory = {
  id: 'identity',
  label: 'Name & username',
  description: 'Your display name, the username you chose (re-confirmed with the service after restore) and the welcome-done flag.',
  keys: [{ key: KEYS.userName }, { key: KEYS.userHandle }, { key: KEYS.onboarded }],
  sanitize: (values) => {
    const out: CategoryValues = {};
    const name = values[KEYS.userName];
    if (name !== undefined && name !== null) {
      if (typeof name !== 'string') return { error: 'Display name is not text.' };
      out[KEYS.userName] = name.trim().slice(0, 80);
    }
    const handle = values[KEYS.userHandle];
    if (handle !== undefined && handle !== null) {
      if (typeof handle !== 'string') return { error: 'Username is not text.' };
      const h = handle.trim().toLowerCase();
      if (h && !USERNAME_RE.test(h)) return { error: 'Username has an invalid format.' };
      if (h) out[KEYS.userHandle] = h;
    }
    if (values[KEYS.onboarded] !== undefined) out[KEYS.onboarded] = values[KEYS.onboarded] === true;
    return { values: out };
  },
  summarize: (values) => {
    const name = str(values[KEYS.userName]);
    const handle = str(values[KEYS.userHandle]);
    return [name, handle ? `@${handle}` : null].filter(Boolean).join(' · ') || 'No name saved';
  },
};

const LIST_CAPS = { karaoke: 12, prefs: 50 } as const;

const extrasCategory: BackupCategory = {
  id: 'extras',
  label: 'Alarm, lyrics, streak & app preferences',
  description: 'Wake-up alarm, lyric sync offsets, karaoke history, listening streak, sidebar groups, saved AI prompts and AI reply preferences.',
  keys: [
    { key: KEYS.alarm },
    { key: KEYS.lyricsOffset },
    { key: KEYS.karaoke },
    { key: STREAK_KEY },
    { key: NAV_GROUPS_KEY },
    { key: SAVED_PROMPTS_KEY },
    { key: 'vinax.aiDefaultMode', raw: true },
    { key: 'vinax.aiProfile', raw: true },
    { key: 'vinax.aiFontSize', raw: true },
    { key: 'vinax.aiReplyLang', raw: true },
    { key: 'vinax.aiReplyStyle', raw: true },
  ],
  sanitize: (values, ctx) => {
    const out: CategoryValues = {};
    for (const spec of extrasCategory.keys) {
      const v = values[spec.key];
      if (v === undefined || v === null) continue;
      if (spec.raw) {
        if (typeof v !== 'string') return { error: `Preference ${spec.key} is not text.` };
        out[spec.key] = v.slice(0, 200);
        continue;
      }
      if (spec.key === KEYS.alarm) {
        const env = envelope(v);
        if (!env) return { error: 'Alarm settings are malformed.' };
        // "HH:MM", real booleans and a known action — the scheduler splits `time`.
        out[spec.key] = wrap({ ...sanitizeAlarm(env.state) }, storeVersion(KEYS.alarm));
      } else if (spec.key === KEYS.lyricsOffset) {
        const env = envelope(v);
        if (!env || (env.state.offsets !== undefined && !isObj(env.state.offsets))) return { error: 'Lyric offsets are malformed.' };
        out[spec.key] = wrap({ offsets: sanitizeLyricOffsets(env.state.offsets) }, storeVersion(KEYS.lyricsOffset));
      } else if (spec.key === KEYS.karaoke) {
        if (!Array.isArray(v)) return { error: 'Karaoke history is malformed.' };
        out[spec.key] = capped(v.filter(isObj).map((s) => ({ song: sanitizeSong(s.song), at: num(s.at) ?? Date.now() })).filter((s) => s.song), LIST_CAPS.karaoke, 'Karaoke history', ctx);
      } else if (spec.key === STREAK_KEY) {
        if (!isObj(v) || num(v.count) === null || typeof v.lastDay !== 'string') return { error: 'Streak data is malformed.' };
        out[spec.key] = { count: v.count, lastDay: v.lastDay.slice(0, 10), best: num(v.best) ?? v.count };
      } else if (spec.key === NAV_GROUPS_KEY) {
        if (!Array.isArray(v)) return { error: 'App preference list is malformed.' };
        out[spec.key] = capped(v.filter((g): g is string => typeof g === 'string').map((g) => g.slice(0, 80)), LIST_CAPS.prefs, 'Sidebar groups', ctx);
      } else if (spec.key === SAVED_PROMPTS_KEY) {
        if (!Array.isArray(v)) return { error: 'App preference list is malformed.' };
        out[spec.key] = capped(v.filter(isObj).filter((x) => typeof x.text === 'string'), LIST_CAPS.prefs, 'Saved prompts', ctx);
      }
    }
    return { values: out };
  },
  summarize: (values) => {
    const parts: string[] = [];
    const alarm = envelope(values[KEYS.alarm])?.state;
    if (alarm) parts.push(alarm.enabled ? `alarm ${String(alarm.time)}` : 'alarm off');
    const offsets = envelope(values[KEYS.lyricsOffset])?.state.offsets;
    if (isObj(offsets) && Object.keys(offsets).length) parts.push(`${Object.keys(offsets).length} lyric offsets`);
    const streak = values[STREAK_KEY];
    if (isObj(streak)) parts.push(`streak ${String(streak.count)} (best ${String(streak.best ?? streak.count)})`);
    if (Array.isArray(values[SAVED_PROMPTS_KEY])) parts.push(`${(values[SAVED_PROMPTS_KEY] as unknown[]).length} saved prompts`);
    return parts.join(' · ') || 'Nothing saved';
  },
  /**
   * Key by key, because these are unrelated things sharing a category:
   * lists are unioned (this device first), per-song offsets keep this
   * device's value, the streak keeps whichever side is more recent with the
   * best of both, and the alarm — one deliberate setting — stays as it is
   * here. The text preferences follow the file, like settings do.
   */
  merge: (current, incoming) => {
    const out: CategoryValues = { ...current, ...incoming };
    if (current[KEYS.alarm] !== undefined) out[KEYS.alarm] = current[KEYS.alarm];
    const offA = envelope(current[KEYS.lyricsOffset]);
    const offB = envelope(incoming[KEYS.lyricsOffset]);
    if (offA && offB) out[KEYS.lyricsOffset] = wrap({ offsets: { ...(offB.state.offsets as Record<string, number>), ...(offA.state.offsets as Record<string, number>) } }, storeVersion(KEYS.lyricsOffset));
    const sessions = (v: unknown) => (Array.isArray(v) ? (v as Array<{ song: Song; at: number }>) : []);
    if (current[KEYS.karaoke] !== undefined || incoming[KEYS.karaoke] !== undefined) {
      const seen = new Set<string>();
      out[KEYS.karaoke] = [...sessions(current[KEYS.karaoke]), ...sessions(incoming[KEYS.karaoke])]
        .sort((x, y) => y.at - x.at)
        .filter((x) => (seen.has(x.song.id) ? false : (seen.add(x.song.id), true)))
        .slice(0, LIST_CAPS.karaoke);
    }
    const a = current[STREAK_KEY];
    const b = incoming[STREAK_KEY];
    if (isObj(a) && isObj(b)) {
      // lastDay is YYYY-MM-DD, so string order is date order.
      const later = String(b.lastDay) > String(a.lastDay) ? b : a;
      out[STREAK_KEY] = { count: later.count, lastDay: later.lastDay, best: Math.max(num(a.best) ?? 0, num(b.best) ?? 0, num(a.count) ?? 0, num(b.count) ?? 0) };
    }
    if (Array.isArray(current[NAV_GROUPS_KEY]) && Array.isArray(incoming[NAV_GROUPS_KEY])) {
      // The ceiling never drops below what this device already holds.
      const mine = current[NAV_GROUPS_KEY] as string[];
      out[NAV_GROUPS_KEY] = [...new Set([...mine, ...(incoming[NAV_GROUPS_KEY] as string[])])].slice(0, Math.max(LIST_CAPS.prefs, mine.length));
    }
    if (Array.isArray(current[SAVED_PROMPTS_KEY]) && Array.isArray(incoming[SAVED_PROMPTS_KEY])) {
      const seen = new Set<string>();
      const idOf = (x: Record<string, unknown>) => (typeof x.id === 'string' && x.id ? `id:${x.id}` : `text:${String(x.text)}`);
      const mine = current[SAVED_PROMPTS_KEY] as Record<string, unknown>[];
      out[SAVED_PROMPTS_KEY] = [...mine, ...(incoming[SAVED_PROMPTS_KEY] as Record<string, unknown>[])]
        .filter((x) => (seen.has(idOf(x)) ? false : (seen.add(idOf(x)), true)))
        .slice(0, Math.max(LIST_CAPS.prefs, mine.length));
    }
    return out;
  },
};

const aiChatsCategory: BackupCategory = {
  id: 'aiChats',
  label: 'VinaX AI chats',
  description: 'Your conversation history (attachments are never stored).',
  keys: [{ key: KEYS.aiChats }],
  sanitize: (values, ctx) => {
    const v = values[KEYS.aiChats];
    if (v === undefined || v === null) return { values: {} };
    if (!Array.isArray(v)) return { error: 'AI chat history is malformed.' };
    return { values: { [KEYS.aiChats]: capped(v.filter(isObj).filter((c) => typeof c.id === 'string' && Array.isArray(c.messages)), 50, 'VinaX AI chats', ctx) } };
  },
  summarize: (values) => {
    const n = Array.isArray(values[KEYS.aiChats]) ? (values[KEYS.aiChats] as unknown[]).length : 0;
    return `${n} chat${n === 1 ? '' : 's'}`;
  },
  merge: (current, incoming) => {
    const a = Array.isArray(current[KEYS.aiChats]) ? (current[KEYS.aiChats] as { id: string }[]) : [];
    const b = Array.isArray(incoming[KEYS.aiChats]) ? (incoming[KEYS.aiChats] as { id: string }[]) : [];
    return { [KEYS.aiChats]: uniqueById([...a, ...b]).slice(0, 50) };
  },
};

export const BACKUP_CATEGORIES: readonly BackupCategory[] = [
  settingsCategory,
  libraryCategory,
  smartCollectionsCategory,
  historyCategory,
  tasteCategory,
  searchesCategory,
  bookmarksCategory,
  homeLayoutCategory,
  identityCategory,
  extrasCategory,
  aiChatsCategory,
];

export const categoryById = (id: string): BackupCategory | undefined => BACKUP_CATEGORIES.find((c) => c.id === id);

/** What a backup deliberately leaves out — shown next to the export button. */
export const BACKUP_EXCLUSIONS: ReadonlyArray<{ label: string; why: string }> = [
  { label: 'Downloaded audio and download paths', why: 'Files live on the device that saved them; paths mean nothing elsewhere.' },
  { label: 'Device identity and the service-issued token', why: 'Identity is per install. Use "Move to a new device" to carry it across.' },
  { label: 'Listen Together host keys', why: 'Credentials for rooms you host on this device.' },
  { label: 'Usage-sharing consent', why: 'Asked again per device; sharing stays off after a restore until you turn it on.' },
  { label: 'Queue, playback position and caches', why: 'Session state and cached shelves are rebuilt on the next open.' },
  { label: 'Update reminders and What’s New read state', why: 'Device-specific.' },
];

// -------------------------------------------------------------- file shape --
export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  schemaVersion: typeof BACKUP_SCHEMA_VERSION;
  app: 'vinax';
  appVersion: string;
  exportedAt: string;
  categories: Partial<Record<BackupCategoryId, CategoryValues>>;
}

function readKey(spec: KeySpec): unknown {
  try {
    const raw = window.localStorage.getItem(spec.key);
    if (raw === null) return undefined;
    if (spec.raw) return raw;
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/** Snapshot the listener's portable data from this device. */
export function createBackup(ids: readonly BackupCategoryId[] = BACKUP_CATEGORIES.map((c) => c.id)): BackupFile {
  const categories: BackupFile['categories'] = {};
  for (const cat of BACKUP_CATEGORIES) {
    if (!ids.includes(cat.id)) continue;
    const values: CategoryValues = {};
    for (const spec of cat.keys) {
      const v = readKey(spec);
      if (v !== undefined) values[spec.key] = v;
    }
    if (!Object.keys(values).length) continue;
    const clean = cat.sanitize(values);
    if ('error' in clean) continue; // a corrupt local key is skipped, never exported as-is
    if (Object.keys(clean.values).length) categories[cat.id] = clean.values;
  }
  return { format: BACKUP_FORMAT, schemaVersion: BACKUP_SCHEMA_VERSION, app: 'vinax', appVersion: LATEST_VERSION, exportedAt: new Date().toISOString(), categories };
}

export const serializeBackup = (file: BackupFile): string => JSON.stringify(file, null, 2);

// ------------------------------------------------------------------ parse --
export interface CategoryReport {
  id: BackupCategoryId;
  label: string;
  summary: string;
  values: CategoryValues;
}

export interface ParsedBackup {
  ok: true;
  file: BackupFile;
  /** Set when the file used the old export shape and was migrated. */
  migratedFrom: 'legacy-export' | null;
  warnings: string[];
  categories: CategoryReport[];
  /** Categories present in the file but rejected, with why. Import proceeds without them only when the caller chooses to. */
  rejected: Array<{ id: BackupCategoryId; label: string; error: string }>;
}
export type ParseResult = ParsedBackup | { ok: false; error: string };

/** Old export shape: KEYS names at the top level (`app: 'vinax' | 'tarang'`). */
function migrateLegacy(data: Record<string, unknown>): { categories: BackupFile['categories']; warnings: string[] } {
  const warnings: string[] = [];
  const byKey: Record<string, unknown> = {};
  for (const [name, key] of Object.entries(KEYS)) if (data[name] !== undefined && data[name] !== null) byKey[key] = data[name];
  const categories: BackupFile['categories'] = {};
  const claimed = new Set<string>();
  for (const cat of BACKUP_CATEGORIES) {
    const values: CategoryValues = {};
    for (const spec of cat.keys) {
      if (byKey[spec.key] !== undefined) {
        values[spec.key] = byKey[spec.key];
        claimed.add(spec.key);
      }
    }
    if (Object.keys(values).length) categories[cat.id] = values;
  }
  const skipped = Object.keys(byKey).filter((k) => !claimed.has(k));
  if (skipped.length) warnings.push('This older export also contained device identity, download paths, host keys or caches — those were left out on purpose.');
  return { categories, warnings };
}

export function parseBackup(json: string): ParseResult {
  if (json.length > MAX_BACKUP_BYTES) return { ok: false, error: 'Backup file is larger than 8 MB.' };
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return { ok: false, error: 'This file is not valid JSON.' };
  }
  if (!isObj(data)) return { ok: false, error: 'This file is not a VinaX backup.' };

  let categories: BackupFile['categories'];
  let migratedFrom: ParsedBackup['migratedFrom'] = null;
  const warnings: string[] = [];
  let exportedAt = str(data.exportedAt, 40) ?? '';
  let appVersion = str(data.appVersion, 40) ?? '';

  if (data.format === BACKUP_FORMAT) {
    const v = num(data.schemaVersion);
    if (v === null || v > BACKUP_SCHEMA_VERSION) return { ok: false, error: `This backup needs a newer VinaX (schema ${String(data.schemaVersion)}).` };
    if (!isObj(data.categories)) return { ok: false, error: 'Backup has no data categories.' };
    categories = {};
    for (const [id, values] of Object.entries(data.categories)) {
      if (!categoryById(id)) {
        warnings.push(`Unknown section "${id}" was ignored.`);
        continue;
      }
      if (!isObj(values)) return { ok: false, error: `Section "${id}" is malformed.` };
      categories[id as BackupCategoryId] = values;
    }
  } else if (data.app === 'vinax' || data.app === 'tarang') {
    const m = migrateLegacy(data);
    categories = m.categories;
    warnings.push(...m.warnings);
    migratedFrom = 'legacy-export';
    appVersion = appVersion || 'pre-6.1 export';
  } else {
    return { ok: false, error: 'This file is not a VinaX backup.' };
  }
  exportedAt = exportedAt && !Number.isNaN(Date.parse(exportedAt)) ? exportedAt : '';

  const reports: CategoryReport[] = [];
  const rejected: ParsedBackup['rejected'] = [];
  const cleanCategories: BackupFile['categories'] = {};
  for (const cat of BACKUP_CATEGORIES) {
    const values = categories[cat.id];
    if (!values) continue;
    const clean = cat.sanitize(values, {
      warn: (message) => {
        if (!warnings.includes(message)) warnings.push(message);
      },
    });
    if ('error' in clean) {
      rejected.push({ id: cat.id, label: cat.label, error: clean.error });
      continue;
    }
    if (!Object.keys(clean.values).length) continue;
    cleanCategories[cat.id] = clean.values;
    reports.push({ id: cat.id, label: cat.label, summary: cat.summarize(clean.values), values: clean.values });
  }
  if (!reports.length && !rejected.length) return { ok: false, error: 'This backup is empty.' };
  return {
    ok: true,
    file: { format: BACKUP_FORMAT, schemaVersion: BACKUP_SCHEMA_VERSION, app: 'vinax', appVersion, exportedAt, categories: cleanCategories },
    migratedFrom,
    warnings,
    categories: reports,
    rejected,
  };
}

// ------------------------------------------------------------------ apply --
export type RestoreMode = 'replace' | 'merge';

export interface ApplyOptions {
  mode: RestoreMode;
  /** Categories to restore; default = every valid category in the file. */
  categories?: readonly BackupCategoryId[];
  /**
   * Extra raw writes (`null` removes) appended to the SAME all-or-nothing
   * batch, after the categories — the device handoff uses it so identity keys
   * and the backup land together or not at all.
   */
  extraEntries?: ReadonlyArray<readonly [key: string, raw: string | null]>;
}

export type ApplyResult =
  | { ok: true; applied: BackupCategoryId[]; keysWritten: number; pendingHandle: string | null }
  | (StorageFailure & { applied: [] });

/**
 * Current on-device values for a category (for merge + preview). A merge
 * passes `{ uncapped: true }`: the import caps bound what a FILE may bring
 * in and must never trim what the listener already has on this device.
 */
export function currentCategoryValues(cat: BackupCategory, ctx?: SanitizeContext): CategoryValues {
  const values: CategoryValues = {};
  for (const spec of cat.keys) {
    const v = readKey(spec);
    if (v !== undefined) values[spec.key] = v;
  }
  const clean = cat.sanitize(values, ctx);
  return 'error' in clean ? {} : clean.values;
}

/**
 * Write the chosen categories all-or-nothing. Parsing already sanitized
 * everything, so the only way this fails is storage itself — and then
 * nothing changes and the failure is returned, never a false success.
 */
export function applyBackup(parsed: ParsedBackup, opts: ApplyOptions): ApplyResult {
  const wanted = new Set(opts.categories ?? parsed.categories.map((c) => c.id));
  const entries: Array<readonly [string, string | null]> = [];
  const applied: BackupCategoryId[] = [];
  let pendingHandle: string | null = null;
  for (const report of parsed.categories) {
    if (!wanted.has(report.id)) continue;
    const cat = categoryById(report.id);
    if (!cat) continue;
    let values = report.values;
    if (opts.mode === 'merge' && cat.merge) values = cat.merge(currentCategoryValues(cat, { uncapped: true }), values);
    if (cat.id === 'identity') {
      // The username is a CLAIM, not a fact: it is re-confirmed with the
      // service (features/identity) unless this device already holds it.
      const handle = str(values[KEYS.userHandle]);
      const confirmed = getLocal<string>(KEYS.userHandle, '');
      values = { ...values };
      delete values[KEYS.userHandle];
      if (handle && handle !== confirmed) {
        pendingHandle = handle;
        entries.push([
          KEYS.userHandlePending,
          JSON.stringify({ username: handle, name: str(values[KEYS.userName]) ?? '', since: Date.now(), status: 'pending' }),
        ]);
      }
    }
    for (const spec of cat.keys) {
      const v = values[spec.key];
      if (v === undefined) {
        // Replace mode clears keys the backup does not carry so a restore is
        // a true snapshot — except identity bits, where "absent" must not
        // undo the welcome flow or drop the name this device already has.
        if (opts.mode === 'replace' && cat.id !== 'identity') entries.push([spec.key, null]);
        continue;
      }
      entries.push([spec.key, spec.raw ? String(v) : JSON.stringify(v)]);
    }
    applied.push(cat.id);
  }
  if (opts.extraEntries) entries.push(...opts.extraEntries);
  const res = writeLocalBatch(entries);
  if (!res.ok) return { ...res, applied: [] };
  recordBackupEvent({ lastImportAt: Date.now(), lastImportMode: opts.mode, lastImportCategories: applied });
  return { ok: true, applied, keysWritten: res.written, pendingHandle };
}

// ------------------------------------------------------------------- undo --
/** Where the pre-restore safety copy lives until the tab closes. */
export const RESTORE_UNDO_KEY = 'vinax.backup.undo.v1';

export interface UndoSnapshot {
  at: number;
  entries: Array<[string, string | null]>;
}

export function readUndo(): UndoSnapshot | null {
  try {
    const raw = sessionStorage.getItem(RESTORE_UNDO_KEY);
    const v = raw ? (JSON.parse(raw) as UndoSnapshot) : null;
    return v && Array.isArray(v.entries) ? v : null;
  } catch {
    return null;
  }
}

export function clearUndo(): void {
  try {
    sessionStorage.removeItem(RESTORE_UNDO_KEY);
  } catch {
    /* nothing kept */
  }
}

/**
 * Snapshot the raw keys a restore of `ids` will touch; false when the browser
 * cannot keep it. A failed attempt also REMOVES any older snapshot: left in
 * place, "Undo" after this restore would silently roll back to the state
 * before an EARLIER one. Restoring identity also writes the pending-username
 * key, which belongs to no category — it is captured too.
 */
export function keepUndo(ids: readonly BackupCategoryId[]): boolean {
  const entries: Array<[string, string | null]> = [];
  const grab = (key: string): void => {
    try {
      entries.push([key, localStorage.getItem(key)]);
    } catch {
      /* unreadable key: nothing to restore */
    }
  };
  for (const cat of BACKUP_CATEGORIES) {
    if (!ids.includes(cat.id)) continue;
    for (const spec of cat.keys) grab(spec.key);
    if (cat.id === 'identity') grab(KEYS.userHandlePending);
  }
  try {
    sessionStorage.setItem(RESTORE_UNDO_KEY, JSON.stringify({ at: Date.now(), entries } satisfies UndoSnapshot));
    return true;
  } catch {
    clearUndo();
    return false;
  }
}

export type RestoreResult = ApplyResult & { undoKept: boolean };

/**
 * applyBackup with a safety copy around it. The previous snapshot is read
 * FIRST: if the write fails nothing changed on the device, so that earlier
 * snapshot is still the right undo and is put back instead of being lost.
 */
export function restoreWithUndo(parsed: ParsedBackup, opts: ApplyOptions): RestoreResult {
  let previous: string | null = null;
  try {
    previous = sessionStorage.getItem(RESTORE_UNDO_KEY);
  } catch {
    /* no earlier snapshot readable */
  }
  const undoKept = keepUndo(opts.categories ?? parsed.categories.map((c) => c.id));
  const res = applyBackup(parsed, opts);
  if (!res.ok) {
    try {
      if (previous === null) sessionStorage.removeItem(RESTORE_UNDO_KEY);
      else sessionStorage.setItem(RESTORE_UNDO_KEY, previous);
    } catch {
      clearUndo();
    }
    return { ...res, undoKept: false };
  }
  return { ...res, undoKept };
}

// ------------------------------------------------------------------- meta --
export interface BackupMeta {
  lastExportAt?: number;
  lastExportBytes?: number;
  lastExportCategories?: BackupCategoryId[];
  lastImportAt?: number;
  lastImportMode?: RestoreMode;
  lastImportCategories?: BackupCategoryId[];
}

export function backupMeta(): BackupMeta {
  const m = getLocal<BackupMeta | null>(BACKUP_META_KEY, null);
  return isObj(m) ? (m as BackupMeta) : {};
}

export function recordBackupEvent(patch: BackupMeta): void {
  setLocal(BACKUP_META_KEY, { ...backupMeta(), ...patch });
}

// --------------------------------------------------------------- transfer --
/**
 * "Move to a new device" (encrypted, one-use QR handoff) is the ONE path that
 * deliberately carries device identity: the service-issued token, install id,
 * confirmed username and usage-sharing choice travel so the new phone IS the
 * old one as far as the service is concerned. A plain backup file never
 * includes these (see BACKUP_EXCLUSIONS).
 */
const TRANSFER_KEYS = [KEYS.signedDeviceId, KEYS.deviceId, KEYS.userHandle, KEYS.analyticsConsent] as const;

export interface TransferPayload extends BackupFile {
  transfer: Record<string, unknown>;
}

export function createTransferPayload(): TransferPayload {
  const transfer: Record<string, unknown> = {};
  for (const key of TRANSFER_KEYS) {
    const v = readKey({ key });
    if (v !== undefined) transfer[key] = v;
  }
  return { ...createBackup(), transfer };
}

/** Restore a handoff payload: the backup (replace mode) plus the identity keys, all-or-nothing. */
export function applyTransferPayload(json: string): ApplyResult | { ok: false; error: string } {
  const parsed = parseBackup(json);
  if (!parsed.ok) return parsed;
  if (parsed.rejected.length) return { ok: false, error: `${parsed.rejected[0].label}: ${parsed.rejected[0].error}` };
  let transfer: Record<string, unknown> = {};
  try {
    const raw = JSON.parse(json) as { transfer?: unknown };
    if (isObj(raw.transfer)) transfer = raw.transfer;
  } catch {
    /* parseBackup already accepted the JSON */
  }
  // Identity keys ride in the SAME batch as the backup: a quota error on the
  // last key must not leave a restored library under the wrong device identity.
  const entries: Array<readonly [string, string | null]> = [];
  for (const key of TRANSFER_KEYS) {
    const v = transfer[key];
    if (key === KEYS.userHandle) {
      const h = str(v);
      if (h && USERNAME_RE.test(h)) {
        entries.push([key, JSON.stringify(h)]);
        entries.push([KEYS.userHandlePending, null]);
      }
      continue;
    }
    if (typeof v === 'string' || typeof v === 'boolean') entries.push([key, JSON.stringify(v)]);
  }
  return applyBackup(parsed, { mode: 'replace', extraEntries: entries });
}
