import type { Song } from '@/types';
import { isNativePlatform } from '@/services/native';
import { useSettingsStore } from '@/store/settingsStore';

/**
 * 8.2.0 — song and query embeddings.
 *
 * Contract (shared by the recommendation engine and search):
 * - `getCachedEmbedding(id)` is synchronous and never touches the network; it
 *   returns a unit-length vector the device already holds, or null.
 * - `embedSongs(songs)` warms the cache in the background and never throws.
 * - `embedQuery(text)` returns a unit-length vector for free text, or null
 *   when no embedding engine can answer.
 * - `cosine(a, b)` is the dot product of two unit vectors (0 when either is
 *   missing or the lengths differ).
 *
 * SPACES. Every vector returned here belongs to the ACTIVE SERVER MODEL
 * (`activeEmbeddingModel()`): the model /api/embed answered with. Vectors of
 * different models are never mixed: the cache is keyed `${model}:${songId}`
 * and only the active model's vectors are served. When the server has to
 * fall back to another model the active model switches, the in-memory cache
 * reloads for it, and songs not yet embedded by it read as null until
 * `embedSongs` warms them. On-device vectors (localVectors.ts) are a separate
 * space and are never returned from this module.
 *
 * Storage: an IndexedDB database of its own (`vinax-embeddings`, so the
 * existing `tarang-db` schema is untouched) mirrored into an in-memory Map
 * so reads stay synchronous; at most MAX_CACHED songs, oldest written first
 * out. Requests are batched (64 texts), de-duplicated while in flight and
 * backed off after failures. The listener's AI switch (Settings → aiAssist)
 * turns the network side off; cached vectors stay readable.
 */

const ENDPOINT = isNativePlatform() ? 'https://www.sirimillavinay.online/api/embed' : '/api/embed';
const MODEL_KEY = 'vinax.embed.model.v1';
const BATCH = 64;
/** Songs one embedSongs() call will send at most (the rest wait for a later call). */
const MAX_PER_CALL = 256;
export const MAX_CACHED = 5000;
const REQUEST_TIMEOUT_MS = 15_000;
const QUERY_CACHE_CAP = 200;

export interface StoredVector {
  key: string;
  model: string;
  songId: string;
  v: Float32Array;
  at: number;
}

/** Persistence behind the in-memory map (IndexedDB in the app; swappable in tests). */
export interface VectorStore {
  load(model: string, limit: number): Promise<StoredVector[]>;
  put(rows: StoredVector[]): Promise<void>;
  prune(keep: number): Promise<void>;
}

/* ------------------------------------------------------------------ state */

let activeModel: string | null = readModel();
/** songId → vector, for the active model only. Insertion order ≈ age. */
const mem = new Map<string, Float32Array>();
const inflight = new Set<string>();
const queryCache = new Map<string, Float32Array>();
let hydrated: Promise<void> | null = null;
let hydratedFor: string | null = null;
let retryAfter = 0;
let failures = 0;
let store: VectorStore | null = null;

function readModel(): string | null {
  try {
    const m = window.localStorage.getItem(MODEL_KEY);
    return m && m.length < 100 ? m : null;
  } catch {
    return null;
  }
}

function writeModel(model: string): void {
  try {
    window.localStorage.setItem(MODEL_KEY, model);
  } catch {
    /* memory only */
  }
}

/* --------------------------------------------------------------- IndexedDB */

const DB_NAME = 'vinax-embeddings';
const DB_VERSION = 1;
const STORE = 'vectors';

function idbStore(): VectorStore | null {
  if (typeof window === 'undefined' || !window.indexedDB) return null;
  let dbp: Promise<IDBDatabase> | null = null;
  const open = (): Promise<IDBDatabase> => {
    if (dbp) return dbp;
    dbp = new Promise<IDBDatabase>((resolve, reject) => {
      const req = window.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const s = db.createObjectStore(STORE, { keyPath: 'key' });
          s.createIndex('model', 'model');
          s.createIndex('at', 'at');
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          dbp = null;
        };
        resolve(db);
      };
      req.onerror = () => reject(req.error);
    });
    const attempt = dbp;
    attempt.catch(() => {
      if (dbp === attempt) dbp = null;
    });
    return dbp;
  };
  return {
    load: (model, limit) =>
      open().then(
        (db) =>
          new Promise<StoredVector[]>((resolve, reject) => {
            const req = db.transaction(STORE, 'readonly').objectStore(STORE).index('model').getAll(model, limit);
            req.onsuccess = () => resolve((req.result as StoredVector[]) ?? []);
            req.onerror = () => reject(req.error);
          }),
      ),
    put: (rows) =>
      open().then(
        (db) =>
          new Promise<void>((resolve, reject) => {
            const t = db.transaction(STORE, 'readwrite');
            const s = t.objectStore(STORE);
            for (const r of rows) s.put(r);
            t.oncomplete = () => resolve();
            t.onerror = () => reject(t.error);
          }),
      ),
    prune: (keep) =>
      open().then(
        (db) =>
          new Promise<void>((resolve, reject) => {
            const t = db.transaction(STORE, 'readwrite');
            const s = t.objectStore(STORE);
            const count = s.count();
            count.onsuccess = () => {
              let extra = count.result - keep;
              if (extra <= 0) return;
              const cur = s.index('at').openCursor(); // oldest first
              cur.onsuccess = () => {
                const c = cur.result;
                if (!c || extra <= 0) return;
                c.delete();
                extra -= 1;
                c.continue();
              };
            };
            t.oncomplete = () => resolve();
            t.onerror = () => reject(t.error);
          }),
      ),
  };
}

function getStore(): VectorStore | null {
  if (!store) store = idbStore();
  return store;
}

/** Load the active model's stored vectors into memory (once per model). */
function hydrate(): Promise<void> {
  const model = activeModel;
  if (!model) return Promise.resolve();
  if (hydrated && hydratedFor === model) return hydrated;
  hydratedFor = model;
  const s = getStore();
  hydrated = (s ? s.load(model, MAX_CACHED) : Promise.resolve([] as StoredVector[]))
    .then((rows) => {
      if (activeModel !== model) return;
      rows.sort((a, b) => a.at - b.at);
      for (const r of rows) {
        if (r && r.v instanceof Float32Array && !mem.has(r.songId)) remember(r.songId, r.v);
      }
    })
    .catch(() => undefined);
  return hydrated;
}

function remember(songId: string, v: Float32Array): void {
  mem.delete(songId);
  mem.set(songId, v);
  while (mem.size > MAX_CACHED) {
    const oldest = mem.keys().next().value;
    if (oldest === undefined) break;
    mem.delete(oldest);
  }
}

/** Adopt the model the server answered with; switching models drops the old space from memory. */
function adoptModel(model: string): void {
  if (model === activeModel) return;
  activeModel = model;
  writeModel(model);
  mem.clear();
  queryCache.clear();
  hydrated = null;
  hydratedFor = null;
  void hydrate();
}

/* ----------------------------------------------------------------- network */

const withJitter = (ms: number): number => ms + Math.floor(Math.random() * ms * 0.2);

function networkAllowed(): boolean {
  if (Date.now() < retryAfter) return false;
  try {
    return useSettingsStore.getState().aiAssist !== false;
  } catch {
    return true;
  }
}

function backOff(status: number | null, error?: string): void {
  failures += 1;
  let ms: number;
  if (status === 404 || status === 405) ms = 30 * 60_000; // the deployed backend predates this route
  else if (error === 'ai_disabled') ms = 30 * 60_000;
  else if (status === 429) ms = 60_000;
  else ms = Math.min(15 * 60_000, 30_000 * 2 ** Math.min(failures - 1, 5));
  retryAfter = Date.now() + withJitter(ms);
}

interface EmbedAnswer {
  model: string;
  vectors: Float32Array[];
}

async function request(texts: string[], kind: 'query' | 'passage', signal?: AbortSignal): Promise<EmbedAnswer | null> {
  const ctrl = new AbortController();
  const abort = () => ctrl.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-vinax-client': isNativePlatform() ? 'app' : 'web' },
      body: JSON.stringify({ texts, kind, ...(activeModel ? { prefer: activeModel } : {}) }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
      backOff(res.status, typeof body?.error === 'string' ? body.error : undefined);
      return null;
    }
    const data = (await res.json().catch(() => null)) as { model?: unknown; vectors?: unknown } | null;
    const model = typeof data?.model === 'string' && data.model ? data.model.slice(0, 100) : null;
    const rows = Array.isArray(data?.vectors) ? (data.vectors as unknown[]) : null;
    if (!model || !rows || rows.length !== texts.length) {
      backOff(null);
      return null;
    }
    const vectors: Float32Array[] = [];
    for (const r of rows) {
      const v = toUnit(r);
      if (!v || (vectors[0] && v.length !== vectors[0].length)) {
        backOff(null);
        return null;
      }
      vectors.push(v);
    }
    failures = 0;
    return { model, vectors };
  } catch {
    if (!signal?.aborted) backOff(null);
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

/** A server row as a unit Float32Array (renormalised: never trust the wire). */
function toUnit(row: unknown): Float32Array | null {
  if (!Array.isArray(row) || row.length < 8 || row.length > 4096) return null;
  const v = new Float32Array(row.length);
  let sum = 0;
  for (let i = 0; i < row.length; i += 1) {
    const x = row[i];
    if (typeof x !== 'number' || !Number.isFinite(x)) return null;
    v[i] = x;
    sum += x * x;
  }
  if (!(sum > 0)) return null;
  const inv = 1 / Math.sqrt(sum);
  for (let i = 0; i < v.length; i += 1) v[i] *= inv;
  return v;
}

/* ------------------------------------------------------------------ public */

/** The text a song is embedded from: title, artists, album, language, year, genre, mood, vibe. */
export function songPassage(song: Song): string {
  const parts: string[] = [];
  const title = (song.title ?? '').trim();
  const artists = (song.artists ?? []).map((a) => a.name).filter(Boolean).slice(0, 4).join(', ') || (song.subtitle ?? '').trim();
  parts.push(artists ? `${title} by ${artists}` : title);
  if (song.album?.name && song.album.name !== title) parts.push(`Album: ${song.album.name}`);
  if (song.language && song.language !== 'unknown') parts.push(`Language: ${song.language}`);
  if (song.year) parts.push(`Year: ${song.year}`);
  const genres = [song.genre, ...(song.genres ?? [])].filter((g): g is string => !!g);
  if (genres.length) parts.push(`Genre: ${[...new Set(genres)].slice(0, 3).join(', ')}`);
  if (song.mood) parts.push(`Mood: ${song.mood}`);
  const vibes = [song.vibe, ...(song.vibes ?? [])].filter((g): g is string => !!g);
  if (vibes.length) parts.push(`Vibe: ${[...new Set(vibes)].slice(0, 3).join(', ')}`);
  if (typeof song.energy === 'number') parts.push(`Energy: ${song.energy >= 0.6 ? 'high' : song.energy <= 0.4 ? 'low' : 'medium'}`);
  return parts.join('. ').replace(/\s+/g, ' ').trim().slice(0, 500);
}

/** The server model whose space every vector from this module belongs to (null before the first answer). */
export function activeEmbeddingModel(): string | null {
  return activeModel;
}

/**
 * A vector for this song in the active server model's space, or null.
 * Synchronous, never touches the network. Never an on-device vector — use
 * localSongVector() from localVectors.ts for those, and never compare the two.
 */
export function getCachedEmbedding(songId: string): Float32Array | null {
  if (activeModel && hydratedFor !== activeModel) void hydrate();
  return mem.get(songId) ?? null;
}

/** Warm the cache for these songs (batched, de-duplicated, backed off). Never throws. */
export async function embedSongs(songs: Song[]): Promise<void> {
  try {
    await hydrate();
    const todo: Song[] = [];
    const seen = new Set<string>();
    for (const s of songs) {
      if (!s || typeof s.id !== 'string' || !s.id || seen.has(s.id)) continue;
      seen.add(s.id);
      if (mem.has(s.id) || inflight.has(s.id)) continue;
      todo.push(s);
      if (todo.length >= MAX_PER_CALL) break;
    }
    for (let i = 0; i < todo.length; i += BATCH) {
      if (!networkAllowed()) return;
      const batch = todo.slice(i, i + BATCH).filter((s) => !mem.has(s.id));
      if (!batch.length) continue;
      for (const s of batch) inflight.add(s.id);
      try {
        const got = await request(batch.map(songPassage), 'passage');
        if (!got) return;
        adoptModel(got.model);
        const at = Date.now();
        const rows: StoredVector[] = batch.map((s, n) => ({ key: `${got.model}:${s.id}`, model: got.model, songId: s.id, v: got.vectors[n], at }));
        for (const r of rows) remember(r.songId, r.v);
        const st = getStore();
        if (st) void st.put(rows).then(() => st.prune(MAX_CACHED)).catch(() => undefined);
      } finally {
        for (const s of batch) inflight.delete(s.id);
      }
    }
  } catch {
    /* never throws */
  }
}

/** A query vector together with the model space it belongs to. */
export async function embedQueryDetailed(text: string, signal?: AbortSignal): Promise<{ model: string; vector: Float32Array } | null> {
  const q = text.replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!q) return null;
  const cached = activeModel ? queryCache.get(`${activeModel}|${q.toLowerCase()}`) : undefined;
  if (cached && activeModel) return { model: activeModel, vector: cached };
  if (!networkAllowed()) return null;
  const got = await request([q], 'query', signal);
  if (!got) return null;
  adoptModel(got.model);
  const vector = got.vectors[0];
  if (queryCache.size >= QUERY_CACHE_CAP) queryCache.delete(queryCache.keys().next().value as string);
  queryCache.set(`${got.model}|${q.toLowerCase()}`, vector);
  return { model: got.model, vector };
}

export async function embedQuery(text: string): Promise<Float32Array | null> {
  try {
    const got = await embedQueryDetailed(text);
    // Only a vector in the space the cache now serves is useful to a caller.
    return got && got.model === activeModel ? got.vector : null;
  } catch {
    return null;
  }
}

export function cosine(a: Float32Array | null | undefined, b: Float32Array | null | undefined): number {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

/** 8.2.0 — Erase everything: drop every cached vector, the remembered model and the database itself. */
export async function eraseEmbeddings(): Promise<void> {
  mem.clear();
  inflight.clear();
  queryCache.clear();
  hydrated = null;
  hydratedFor = null;
  activeModel = null;
  store = null;
  try {
    window.localStorage.removeItem(MODEL_KEY);
  } catch {
    /* memory only */
  }
  if (typeof window === 'undefined' || !window.indexedDB) return;
  await new Promise<void>((resolve) => {
    try {
      const req = window.indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Test hook: forget all state (as on a fresh start) and use `s` as the persistent store. */
export function __resetEmbeddingsForTests(s: VectorStore | null = null): void {
  activeModel = readModel();
  mem.clear();
  inflight.clear();
  queryCache.clear();
  hydrated = null;
  hydratedFor = null;
  retryAfter = 0;
  failures = 0;
  store = s;
}
