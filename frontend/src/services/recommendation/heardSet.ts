import type { Song } from '@/types';
import { canonicalKey } from './identityCore';
import { songKey } from './songKey';
import { BloomFilter } from './bloom';
import { registerHeardCheck } from './admission';
// Static on purpose: these are first-load modules already, and a dynamic import of one
// would make the bundler add a namespace object for it to the first-load chunk.
import { onPlaybackEvent } from '@/services/playback/session';
import { getRecentEvents } from '@/services/storage/idb';
import { useHistoryStore } from '@/store/historyStore';
import { isSkippedPlay } from '@/utils/plays';

/** A restore writes the file's keys here; the next load adds them to the set and removes the key. */
export const HEARD_IMPORT_KEY = 'vinax.recs.heard.import.v1';
/** The most keys one backup file may bring in (the backup's own cap matches). */
export const HEARD_IMPORT_MAX = 200_000;

/**
 * The lifetime heard-set: the canonical identity (`songKey`, ./identityCore.ts)
 * of every song that ever produced a PLAY on the playback bus. It is what
 * Never repeat reads ("never a song I have heard"), so unlike the exposure
 * ledger it has no row cap and no expiry: a song heard two years ago is still
 * heard.
 *
 *   - Stored in its own IndexedDB database (`vinax-heard`), one row per key.
 *   - Looked up through an in-memory Bloom filter (./bloom.ts) sized for about
 *     1 % false positives: a heard song is never missed, and about one
 *     never-heard song in a hundred is passed over.
 *   - Recorded for every play, whether Never repeat is on or not, so turning
 *     it on later already knows the listener's past. The first load also
 *     backfills from the listening history and the listen-event log.
 *   - Carried in the one-file backup (the `heard` category), never in the
 *     account sync: it stays on the device. "Erase everything" deletes it.
 *
 * Keyed by canonical identity, so a remaster, a remix or another cut of a
 * heard song counts as heard.
 */

export const HEARD_DB_NAME = 'vinax-heard';
const HEARD_STORE = 'heard';
/** Set once the history and event log have been read into the set. */
export const HEARD_BACKFILL_KEY = 'vinax.recs.heard.backfill.v1';
export const HEARD_FP_RATE = 0.01;
/** The filter starts sized for this many songs and doubles past what it holds. */
const MIN_CAPACITY = 4_096;
/** New keys are written in one transaction after this pause. */
const FLUSH_MS = 1_500;

/** Where the keys live. IndexedDB in the app; a Map where IndexedDB is missing (tests, some private windows). */
export interface HeardBackend {
  load(): Promise<string[]>;
  add(keys: readonly string[], at: number): Promise<void>;
  clear(): Promise<void>;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** The IndexedDB backend: one store, the canonical key as the row key and the first time it was heard as the value. */
export function idbBackend(factory: IDBFactory | undefined = typeof indexedDB === 'undefined' ? undefined : indexedDB): HeardBackend | null {
  if (!factory) return null;
  let db: Promise<IDBDatabase> | null = null;
  const open = (): Promise<IDBDatabase> => {
    if (db) return db;
    const attempt = new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(HEARD_DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(HEARD_STORE)) req.result.createObjectStore(HEARD_STORE);
      };
      req.onsuccess = () => {
        const conn = req.result;
        // "Erase everything" deletes the database: let go so the delete is not blocked.
        conn.onversionchange = () => {
          conn.close();
          db = null;
        };
        resolve(conn);
      };
      req.onerror = () => reject(req.error);
    });
    db = attempt;
    attempt.catch(() => {
      if (db === attempt) db = null;
    });
    return attempt;
  };
  const run = async <T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> => {
    const conn = await open();
    return new Promise<T | undefined>((resolve, reject) => {
      const tx = conn.transaction(HEARD_STORE, mode);
      let result: T | undefined;
      const req = fn(tx.objectStore(HEARD_STORE));
      if (req) request(req).then((r) => { result = r; }, reject);
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  };
  return {
    load: async () => ((await run<IDBValidKey[]>('readonly', (s) => s.getAllKeys())) ?? []).filter((k): k is string => typeof k === 'string'),
    add: async (keys, at) => {
      if (!keys.length) return;
      await run('readwrite', (s) => {
        for (const k of keys) s.put(at, k);
      });
    },
    clear: async () => {
      await run('readwrite', (s) => s.clear());
    },
  };
}

export function memoryBackend(): HeardBackend {
  const rows = new Map<string, number>();
  return {
    load: async () => [...rows.keys()],
    add: async (keys, at) => {
      for (const k of keys) if (!rows.has(k)) rows.set(k, at);
    },
    clear: async () => rows.clear(),
  };
}

/** What the first load reads into the set: earlier plays, as title and lead artist. */
export interface BackfillSource {
  plays(): Promise<Array<{ title: string; artist: string }>>;
}

export interface HeardInitOptions {
  backend?: HeardBackend;
  backfill?: BackfillSource | null;
  now?: () => number;
  /** Subscribe to the playback bus (default true). */
  listen?: boolean;
}

let backend: HeardBackend | null = null;
let filter = new BloomFilter(MIN_CAPACITY, HEARD_FP_RATE);
let known = 0;
let pending = new Set<string>();
/** Keys handed to the store and not confirmed yet. */
let writing = new Set<string>();
/** Keys added while a rebuild is reading the store, so the new filter has them too. */
let duringRebuild: Set<string> | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let readyPromise: Promise<void> | null = null;
let stopListening: (() => void) | null = null;
let clock: () => number = Date.now;

const readLocal = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};
const removeLocal = (key: string): void => {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* storage may be unavailable */
  }
};
const writeLocal = (key: string, value: string): void => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage may be unavailable */
  }
};

function scheduleFlush(): void {
  if (flushTimer || !pending.size) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushHeard();
  }, FLUSH_MS);
}

/** Write the keys heard since the last write. A failed write keeps them for the next one. */
export async function flushHeard(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (!backend || !pending.size) return;
  const batch = [...pending];
  pending = new Set();
  for (const k of batch) writing.add(k);
  try {
    await backend.add(batch, clock());
  } catch {
    for (const k of batch) pending.add(k);
  } finally {
    for (const k of batch) writing.delete(k);
  }
}

async function rebuild(): Promise<void> {
  if (!backend || duringRebuild) return;
  // Everything not yet confirmed by the store when the read starts, and everything added while it runs.
  const unconfirmed = new Set([...pending, ...writing]);
  duringRebuild = unconfirmed;
  try {
    const stored = await backend.load();
    const all = new Set([...stored, ...unconfirmed, ...pending, ...writing]);
    const next = new BloomFilter(Math.max(MIN_CAPACITY, all.size * 2), HEARD_FP_RATE);
    for (const k of all) next.add(k);
    filter = next;
    known = all.size;
  } catch {
    /* the old filter keeps working, a little less precisely */
  } finally {
    duringRebuild = null;
  }
}

/**
 * Add canonical keys to the set. Returns how many the filter did not know.
 *
 * Every key is written, even one the filter already answers "heard" for: that
 * answer may be a false positive, and a key that never reaches the store would
 * be forgotten at the next rebuild or reload. Writing a key twice costs nothing.
 */
export function recordHeardKeys(keys: readonly string[]): number {
  let added = 0;
  for (const key of keys) {
    if (!key) continue;
    if (!filter.has(key)) {
      filter.add(key);
      known += 1;
      added += 1;
    }
    pending.add(key);
    duringRebuild?.add(key);
  }
  if (pending.size) scheduleFlush();
  if (filter.full) void rebuild();
  return added;
}

/** A song produced a PLAY: it is heard from now on. */
export function recordHeard(song: Song): void {
  if (!song?.title) return;
  recordHeardKeys([songKey(song)]);
}

export function hasHeardKey(key: string): boolean {
  return !!key && filter.has(key);
}

export function hasHeard(song: Song): boolean {
  return !!song?.title && filter.has(songKey(song));
}

/** About how many songs the set holds (exact after a load or a rebuild; false positives can hide a few in between). */
export function heardCount(): number {
  return known;
}

/** Resolves once the stored set is in memory (immediately if it never started). */
export function heardReady(): Promise<void> {
  return readyPromise ?? Promise.resolve();
}

function sanitizeImport(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as { keys?: unknown };
    return Array.isArray(v?.keys) ? v.keys.filter((k): k is string => typeof k === 'string' && k.length > 0 && k.length <= 400).slice(0, HEARD_IMPORT_MAX) : [];
  } catch {
    return [];
  }
}

const defaultBackfill: BackfillSource = {
  plays: async () => {
    const out: Array<{ title: string; artist: string }> = [];
    for (const e of useHistoryStore.getState().entries) {
      if (e?.song?.title && !isSkippedPlay(e)) out.push({ title: e.song.title, artist: e.song.artists?.[0]?.name ?? e.song.subtitle?.split(',')[0] ?? '' });
    }
    for (const e of await getRecentEvents(5_000)) {
      if ((e.type === 'play' || e.type === 'complete') && e.title) out.push({ title: e.title, artist: e.artistNames?.[0] ?? '' });
    }
    return out;
  },
};

/**
 * Load the set and start recording plays. Idempotent: every caller shares one
 * load. Order: the stored keys, then a pending restore, then (first time only)
 * the history and event log.
 */
export function initHeardSet(opts: HeardInitOptions = {}): Promise<void> {
  if (readyPromise) return readyPromise;
  clock = opts.now ?? Date.now;
  backend = opts.backend ?? idbBackend() ?? memoryBackend();
  const store = backend;
  readyPromise = (async () => {
    let stored: string[] = [];
    try {
      stored = await store.load();
    } catch {
      /* a store that cannot open still records this session in memory */
    }
    filter = new BloomFilter(Math.max(MIN_CAPACITY, stored.length * 2), HEARD_FP_RATE);
    known = 0;
    for (const k of new Set(stored)) {
      filter.add(k);
      known += 1;
    }
    // Plays recorded while the store was loading are already pending: keep them in the new filter.
    for (const k of pending) {
      if (filter.has(k)) continue;
      filter.add(k);
      known += 1;
    }
    const imported = sanitizeImport(readLocal(HEARD_IMPORT_KEY));
    if (imported.length) recordHeardKeys(imported);
    removeLocal(HEARD_IMPORT_KEY);
    const backfill = opts.backfill === undefined ? defaultBackfill : opts.backfill;
    if (backfill && !readLocal(HEARD_BACKFILL_KEY)) {
      try {
        const plays = await backfill.plays();
        recordHeardKeys(plays.map((p) => canonicalKey(p.title, p.artist)));
        writeLocal(HEARD_BACKFILL_KEY, String(clock()));
      } catch {
        /* tried again on the next load */
      }
    }
    registerHeardCheck(hasHeardKey);
    await flushHeard();
  })();
  if (opts.listen !== false) listen();
  return readyPromise;
}

function listen(): void {
  if (stopListening) return;
  const off = onPlaybackEvent((e) => {
    if (e.kind === 'counted') recordHeard(e.song);
  });
  const onHide = (): void => {
    if (document.visibilityState === 'hidden') void flushHeard();
  };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onHide);
  stopListening = () => {
    off();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onHide);
    stopListening = null;
  };
}

/** Every key, for the backup file. */
export async function exportHeardKeys(): Promise<string[]> {
  await heardReady();
  await flushHeard();
  const stored = backend ? await backend.load().catch(() => [] as string[]) : [];
  return [...new Set([...stored, ...pending])];
}

/** "Erase everything": forget every key and delete the database. */
export async function eraseHeardSet(factory: IDBFactory | undefined = typeof indexedDB === 'undefined' ? undefined : indexedDB): Promise<void> {
  pending = new Set();
  filter = new BloomFilter(MIN_CAPACITY, HEARD_FP_RATE);
  known = 0;
  try {
    await backend?.clear();
  } catch {
    /* the delete below still runs */
  }
  if (!factory) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 1_500);
    try {
      const req = factory.deleteDatabase(HEARD_DB_NAME);
      const done = (): void => {
        clearTimeout(timer);
        resolve();
      };
      req.onsuccess = done;
      req.onerror = done;
      req.onblocked = done;
    } catch {
      clearTimeout(timer);
      resolve();
    }
  });
}

/** Tests: forget everything in memory (the backend is left alone). */
export function resetHeardSetForTests(): void {
  stopListening?.();
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  backend = null;
  filter = new BloomFilter(MIN_CAPACITY, HEARD_FP_RATE);
  known = 0;
  pending = new Set();
  writing = new Set();
  duringRebuild = null;
  readyPromise = null;
  clock = Date.now;
  registerHeardCheck(undefined);
}
