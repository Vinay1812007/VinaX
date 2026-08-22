/**
 * Minimal promise-based IndexedDB wrapper (no dependency). Used for the
 * listen-event log that powers taste-profile insights — larger and more
 * structured than what we want in localStorage.
 */
const DB_NAME = 'tarang-db';
const DB_VERSION = 1;
export const EVENTS_STORE = 'events';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = window.indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(EVENTS_STORE)) {
        const store = db.createObjectStore(EVENTS_STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('ts', 'ts');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(EVENTS_STORE, mode);
        const req = fn(t.objectStore(EVENTS_STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export interface StoredEvent {
  id?: number;
  ts: number;
  type: string;
  songId: string;
  title: string;
  artistNames: string[];
  language: string | null;
  playedSec?: number;
  songDuration?: number | null;
}

/**
 * Cap on the event log. Every play/skip/complete/queue-add/favorite writes
 * a row and nothing ever trimmed — after weeks of daily use the store held
 * tens of thousands of rows and `getRecentEvents(500)` materialized the whole
 * array via `getAll()` before slicing (audit finding H5). A periodic prune
 * keeps the store at MAX_EVENTS + PRUNE_TRIGGER — we only walk the cursor
 * when we're actually over the ceiling, so the write hot-path stays fast.
 */
const MAX_EVENTS = 5000;
const PRUNE_TRIGGER = 250; // extra headroom before pruning again

let lastPruneAt = 0;

async function pruneIfNeeded(): Promise<void> {
  // Rate-limit the size check itself so bursts of writes don't storm the DB.
  const now = Date.now();
  if (now - lastPruneAt < 30_000) return;
  lastPruneAt = now;
  try {
    const count = await tx<number>('readonly', (s) => s.count());
    if (count <= MAX_EVENTS + PRUNE_TRIGGER) return;
    const toDelete = count - MAX_EVENTS;
    await openDb().then(
      (db) =>
        new Promise<void>((resolve, reject) => {
          const t = db.transaction(EVENTS_STORE, 'readwrite');
          const store = t.objectStore(EVENTS_STORE);
          const req = store.openCursor(); // ascending by key = oldest first
          let deleted = 0;
          req.onsuccess = () => {
            const cursor = req.result;
            if (!cursor || deleted >= toDelete) return;
            cursor.delete();
            deleted += 1;
            cursor.continue();
          };
          t.oncomplete = () => resolve();
          t.onerror = () => reject(t.error);
        }),
    );
  } catch {
    /* best effort */
  }
}

export async function addEvent(evt: StoredEvent): Promise<void> {
  try {
    await tx('readwrite', (s) => s.add(evt));
    void pruneIfNeeded();
  } catch {
    // IndexedDB unavailable (private mode etc.) — analytics-grade data only,
    // safe to drop.
  }
}

/**
 * Fetch the newest `limit` events by walking the cursor in reverse instead of
 * materialising the entire store via `getAll()` and slicing. This keeps main-
 * thread cost proportional to `limit` rather than to the whole log.
 */
export async function getRecentEvents(limit = 500): Promise<StoredEvent[]> {
  try {
    return await openDb().then(
      (db) =>
        new Promise<StoredEvent[]>((resolve, reject) => {
          const results: StoredEvent[] = [];
          const t = db.transaction(EVENTS_STORE, 'readonly');
          const req = t.objectStore(EVENTS_STORE).openCursor(null, 'prev');
          req.onsuccess = () => {
            const cursor = req.result;
            if (!cursor || results.length >= limit) {
              // Preserve chronological order (oldest first) for callers that
              // expect `.slice(-N)` semantics.
              results.reverse();
              resolve(results);
              return;
            }
            results.push(cursor.value as StoredEvent);
            cursor.continue();
          };
          req.onerror = () => reject(req.error);
        }),
    );
  } catch {
    return [];
  }
}

export async function eventCount(): Promise<number> {
  try {
    return await tx<number>('readonly', (s) => s.count());
  } catch {
    return 0;
  }
}

export async function clearEvents(): Promise<void> {
  try {
    await tx('readwrite', (s) => s.clear());
  } catch {
    /* ignore */
  }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    if (navigator.storage?.estimate) {
      const e = await navigator.storage.estimate();
      return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
    }
  } catch {
    /* ignore */
  }
  return null;
}
