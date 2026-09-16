import { KEYS } from '@/constants/storage-keys';
import { LATEST_VERSION } from '@/constants/version';
import { getLocal, setLocal, writeLocalBatch, type StorageFailure } from '@/services/storage/local';
import { HOME_DESIGN_KEY, validateHomeDesign } from '@/services/recommendation/homeDesign';
import { pruneTrash } from '@/features/library/trash';
import { normalizeTags } from '@/features/library/tags';
import { USERNAME_RE } from '@/features/identity/handleClaim';
import { SMART_COLLECTIONS_KEY, sanitizeSmartCollections } from '@/features/library/smartCollections';
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

export interface BackupCategory {
  id: BackupCategoryId;
  label: string;
  /** What a listener would recognise inside it. */
  description: string;
  keys: KeySpec[];
  /** Cleans a category's values; returns an error message when the SHAPE is wrong. */
  sanitize(values: CategoryValues): { values: CategoryValues } | { error: string };
  /** Human summary of what a (sanitized) category holds, for previews. */
  summarize(values: CategoryValues): string;
  /** Union an incoming category into the current one (used by merge restores). */
  merge?(current: CategoryValues, incoming: CategoryValues): CategoryValues;
}

// ---------------------------------------------------------------- helpers --
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max = 500): string | null => (typeof v === 'string' ? v.slice(0, max) : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

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
          .map((x) => ({ quality: str(x.quality, 40) ?? '', url: str(x.url, 2000) ?? '' }))
          .filter((x) => x.url)
      : [];
  const artists = Array.isArray(v.artists)
    ? v.artists
        .filter(isObj)
        .map((a) => ({
          id: str(a.id, 128) ?? '',
          name: str(a.name, 200) ?? '',
          ...(str(a.role, 40) ? { role: str(a.role, 40) as string } : {}),
          ...(typeof a.image === 'string' || a.image === null ? { image: a.image as string | null } : {}),
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

const songList = (v: unknown, cap: number): Song[] =>
  Array.isArray(v) ? v.map(sanitizeSong).filter((s): s is Song => !!s).slice(0, cap) : [];

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

function sanitizeCollection(v: unknown): Collection | null {
  if (!isObj(v)) return null;
  const id = str(v.id, 64);
  const name = str(v.name, 120);
  if (!id || !name) return null;
  const c: Collection = { id, name, createdAt: num(v.createdAt) ?? Date.now(), songs: songList(v.songs, 2000) };
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
  return { song, ts, completed: v.completed === true };
}

const HISTORY_CAP = 150;

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
      // Device-bound bits never travel: the inferred region is re-detected.
      const { inferredRegion: _drop, ...state } = env.state;
      void _drop;
      out[KEYS.settings] = wrap(state, env.version);
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
  sanitize: (values) => {
    const env = envelope(values[KEYS.library]);
    if (!env) return { error: 'Library data is not in the expected shape.' };
    const s = env.state;
    for (const field of ['favorites', 'collections', 'saved', 'hiddenSongIds', 'later', 'hiddenArtists']) {
      if (s[field] !== undefined && !Array.isArray(s[field])) return { error: `Library field "${field}" is not a list.` };
    }
    const state = {
      favorites: uniqueById(songList(s.favorites, 5000)),
      collections: uniqueById((Array.isArray(s.collections) ? s.collections : []).map(sanitizeCollection).filter((c): c is Collection => !!c).slice(0, 500)),
      saved: (Array.isArray(s.saved) ? s.saved : [])
        .filter(isObj)
        .map((e) => ({
          id: str(e.id, 128) ?? '',
          kind: e.kind === 'album' || e.kind === 'artist' || e.kind === 'playlist' ? e.kind : null,
          title: str(e.title, 300) ?? '',
          subtitle: str(e.subtitle, 400) ?? '',
          image: typeof e.image === 'string' ? e.image : null,
          savedAt: num(e.savedAt) ?? Date.now(),
        }))
        .filter((e) => e.id && e.kind && e.title)
        .slice(0, 2000),
      hiddenSongIds: (Array.isArray(s.hiddenSongIds) ? s.hiddenSongIds : []).filter((x): x is string => typeof x === 'string').slice(0, 500),
      later: uniqueById(songList(s.later, 500)),
      hiddenArtists: (Array.isArray(s.hiddenArtists) ? s.hiddenArtists : []).filter((x): x is string => typeof x === 'string').slice(0, 500),
      trash: pruneTrash(Array.isArray(s.trash) ? (s.trash as never[]) : []),
    };
    return { values: { [KEYS.library]: wrap(state, env.version) } };
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
          hiddenSongIds: strs(list(A.hiddenSongIds), list(B.hiddenSongIds)).slice(0, 500),
          later: byId(list(A.later), list(B.later)).slice(0, 500),
          hiddenArtists: strs(list(A.hiddenArtists), list(B.hiddenArtists)).slice(0, 500),
          trash: list(A.trash),
        },
        Math.max(a.version, b.version),
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
    return { values: { [SMART_COLLECTIONS_KEY]: wrap({ rules }, env.version) } };
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
    return { [SMART_COLLECTIONS_KEY]: wrap({ rules }, Math.max(a.version, b.version)) };
  },
};

const historyCategory: BackupCategory = {
  id: 'history',
  label: 'Listening history',
  description: `Your last ${HISTORY_CAP} plays, with completion marks.`,
  keys: [{ key: KEYS.history }],
  sanitize: (values) => {
    const env = envelope(values[KEYS.history]);
    if (!env || (env.state.entries !== undefined && !Array.isArray(env.state.entries))) return { error: 'History is not in the expected shape.' };
    const entries = (Array.isArray(env.state.entries) ? env.state.entries : []).map(sanitizeHistoryEntry).filter((e): e is HistoryEntry => !!e).slice(0, HISTORY_CAP);
    return { values: { [KEYS.history]: wrap({ entries }, env.version) } };
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
    const seen = new Set<string>();
    const entries = [...(a.state.entries as HistoryEntry[]), ...(b.state.entries as HistoryEntry[])]
      .filter((e) => (seen.has(`${e.ts}|${e.song.id}`) ? false : (seen.add(`${e.ts}|${e.song.id}`), true)))
      .sort((x, y) => y.ts - x.ts)
      .slice(0, HISTORY_CAP);
    return { [KEYS.history]: wrap({ entries }, Math.max(a.version, b.version)) };
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
      out[key] = v;
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
};

const searchesCategory: BackupCategory = {
  id: 'searches',
  label: 'Saved & recent searches',
  description: 'Saved search presets, pinned and recent searches, and the compact results preference.',
  keys: [{ key: KEYS.search }, { key: SEARCH_WORKSPACE_KEY }],
  sanitize: (values) => {
    const out: CategoryValues = {};
    if (values[KEYS.search] !== undefined) {
      const env = envelope(values[KEYS.search]);
      if (!env) return { error: 'Recent searches are not in the expected shape.' };
      const strs = (x: unknown, cap: number) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string').slice(0, cap) : []);
      out[KEYS.search] = wrap({ recent: strs(env.state.recent, 50), pinned: strs(env.state.pinned, 5), songSort: str(env.state.songSort, 20) ?? 'relevance' }, env.version);
    }
    if (values[SEARCH_WORKSPACE_KEY] !== undefined) {
      const env = envelope(values[SEARCH_WORKSPACE_KEY]);
      if (!env || (env.state.presets !== undefined && !Array.isArray(env.state.presets))) return { error: 'Saved searches are not in the expected shape.' };
      const presets = (Array.isArray(env.state.presets) ? env.state.presets : [])
        .filter(isObj)
        .filter((p) => typeof p.id === 'string' && typeof p.name === 'string' && typeof p.query === 'string')
        .slice(0, 20);
      out[SEARCH_WORKSPACE_KEY] = wrap({ compact: env.state.compact === true, presets }, env.version);
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
      out[SEARCH_WORKSPACE_KEY] = wrap({ compact: a.state.compact === true, presets }, Math.max(a.version, b.version));
    } else if (b) out[SEARCH_WORKSPACE_KEY] = incoming[SEARCH_WORKSPACE_KEY];
    const c = envelope(current[KEYS.search]);
    const d = envelope(incoming[KEYS.search]);
    if (c && d) {
      const pinned = [...new Set([...(c.state.pinned as string[]), ...(d.state.pinned as string[])])].slice(0, 5);
      const recent = [...new Set([...(c.state.recent as string[]), ...(d.state.recent as string[])])].slice(0, 50);
      out[KEYS.search] = wrap({ recent, pinned, songSort: c.state.songSort }, Math.max(c.version, d.version));
    } else if (d) out[KEYS.search] = incoming[KEYS.search];
    return out;
  },
};

const bookmarksCategory: BackupCategory = {
  id: 'bookmarks',
  label: 'Song bookmarks',
  description: 'Moments you marked inside songs.',
  keys: [{ key: BOOKMARKS_KEY }],
  sanitize: (values) => {
    const env = envelope(values[BOOKMARKS_KEY]);
    if (!env || (env.state.marks !== undefined && !isObj(env.state.marks))) return { error: 'Bookmarks are not in the expected shape.' };
    const marks: Record<string, number[]> = {};
    for (const [id, list] of Object.entries(isObj(env.state.marks) ? env.state.marks : {})) {
      if (!Array.isArray(list)) continue;
      const secs = [...new Set(list.filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0).map(Math.round))].sort((x, y) => x - y).slice(0, 12);
      if (secs.length) marks[id.slice(0, 128)] = secs;
    }
    return { values: { [BOOKMARKS_KEY]: wrap({ marks }, env.version) } };
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
    return { [BOOKMARKS_KEY]: wrap({ marks }, Math.max(a.version, b.version)) };
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
  sanitize: (values) => {
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
        out[spec.key] = v;
      } else if (spec.key === KEYS.lyricsOffset) {
        const env = envelope(v);
        if (!env || (env.state.offsets !== undefined && !isObj(env.state.offsets))) return { error: 'Lyric offsets are malformed.' };
        out[spec.key] = v;
      } else if (spec.key === KEYS.karaoke) {
        if (!Array.isArray(v)) return { error: 'Karaoke history is malformed.' };
        out[spec.key] = v.filter(isObj).map((s) => ({ song: sanitizeSong(s.song), at: num(s.at) ?? Date.now() })).filter((s) => s.song).slice(0, 12);
      } else if (spec.key === STREAK_KEY) {
        if (!isObj(v) || num(v.count) === null || typeof v.lastDay !== 'string') return { error: 'Streak data is malformed.' };
        out[spec.key] = { count: v.count, lastDay: v.lastDay, best: num(v.best) ?? v.count };
      } else if (spec.key === NAV_GROUPS_KEY || spec.key === SAVED_PROMPTS_KEY) {
        if (!Array.isArray(v)) return { error: 'App preference list is malformed.' };
        out[spec.key] = v.slice(0, 50);
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
};

const aiChatsCategory: BackupCategory = {
  id: 'aiChats',
  label: 'VinaX AI chats',
  description: 'Your conversation history (attachments are never stored).',
  keys: [{ key: KEYS.aiChats }],
  sanitize: (values) => {
    const v = values[KEYS.aiChats];
    if (v === undefined || v === null) return { values: {} };
    if (!Array.isArray(v)) return { error: 'AI chat history is malformed.' };
    return { values: { [KEYS.aiChats]: v.filter(isObj).filter((c) => typeof c.id === 'string' && Array.isArray(c.messages)).slice(0, 50) } };
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
    const clean = cat.sanitize(values);
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
}

export type ApplyResult =
  | { ok: true; applied: BackupCategoryId[]; keysWritten: number; pendingHandle: string | null }
  | (StorageFailure & { applied: [] });

/** Current on-device values for a category (for merge + preview). */
export function currentCategoryValues(cat: BackupCategory): CategoryValues {
  const values: CategoryValues = {};
  for (const spec of cat.keys) {
    const v = readKey(spec);
    if (v !== undefined) values[spec.key] = v;
  }
  const clean = cat.sanitize(values);
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
    if (opts.mode === 'merge' && cat.merge) values = cat.merge(currentCategoryValues(cat), values);
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
  const res = writeLocalBatch(entries);
  if (!res.ok) return { ...res, applied: [] };
  recordBackupEvent({ lastImportAt: Date.now(), lastImportMode: opts.mode, lastImportCategories: applied });
  return { ok: true, applied, keysWritten: res.written, pendingHandle };
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
  const res = applyBackup(parsed, { mode: 'replace' });
  if (!res.ok) return res;
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
  const w = writeLocalBatch(entries);
  if (!w.ok) return { ...w, applied: [] };
  return res;
}
