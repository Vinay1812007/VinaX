import type { Song } from '@/types';
import { isNativePlatform } from '@/services/native';

/** Task budgets; models and fallback lanes are configured in the server router. */
// v6.5.2 — client leashes sit above the server budgets (metadata 5.5 s,
// ranking 9 s, home 9 s, shelves 14 s) so an answer that is on its way is
// never aborted a second before it lands.
export const RECOMMENDATION_AI_ROUTING = { metadataTimeoutMs: 6500, rankingTimeoutMs: 10_500, homeTimeoutMs: 10_500, shelvesTimeoutMs: 16_000 };
const ENDPOINT = isNativePlatform() ? 'https://www.sirimillavinay.online/api/curate' : '/api/curate';
// v3 (7.2.0): v2 entries could hold energy/tempo a model invented for songs
// that never carried a measurement; bumping the key discards all of them.
const CACHE_KEY = 'vinax.recommendation.ai-metadata.v3';
const RETIRED_CACHE_KEYS = ['vinax.recommendation.ai-metadata.v2'];
const TTL = 30 * 86_400_000;
export interface AiSongMetadata {
  id: string; mood?: string; vibe?: string[]; language?: string;
  dialect?: string; subLanguage?: string; genre?: string[];
  /** Only ever a measurement the client itself supplied and the server echoed (`supplied`). */
  energy?: number; tempo?: number; context?: string[];
  /** Descriptive fields a model inferred (mood, vibe, …) — a guess, not a measurement. */
  inferred?: string[];
  /** Measured fields the server confirmed were supplied by this client (energy, tempo). */
  supplied?: string[];
}
const INFERABLE = new Set(['mood', 'vibe', 'genre', 'context', 'language', 'dialect', 'subLanguage']);
const MEASURED = new Set(['energy', 'tempo']);
interface Entry { at: number; fingerprint: string; metadata: AiSongMetadata }
const pending = new Map<string, Promise<AiSongMetadata[]>>();
let retryAfter = 0;
/** v6.5.1 — set when the route itself is missing (404/405: the deployed
 *  backend predates this client). Every curate task stays quiet for ten
 *  minutes instead of spending a full leash per Home open and per queue
 *  extension on a backend that cannot answer. */
let routeMissingUntil = 0;
/** Test hook. */
export function resetCuratorBackoff(): void { retryAfter = 0; routeMissingUntil = 0; }
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const label = (v: unknown): string | undefined => typeof v === 'string' && v.trim() ? v.trim().toLowerCase().slice(0, 60) : undefined;
const labels = (v: unknown) => (Array.isArray(v) ? v : [v]).map(label).filter((s): s is string => !!s).slice(0, 6);
const numeric = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : undefined;
const fieldList = (v: unknown, allowed: Set<string>): string[] => (Array.isArray(v) ? [...new Set(v.filter((f): f is string => typeof f === 'string' && allowed.has(f)))] : []);
/** What this client sent for one song — a measurement may only come back unchanged. */
type SentMeasurements = Map<string, { energy?: number | null; tempo?: number | null }>;
const sameMeasurement = (got: number | undefined, sent: number | null | undefined, tolerance: number): boolean =>
  got !== undefined && typeof sent === 'number' && Math.abs(got - sent) <= tolerance;

export async function requestCurator(task: 'metadata' | 'ranking' | 'home' | 'shelves', data: unknown, signal?: AbortSignal): Promise<unknown> {
  if (Date.now() < routeMissingUntil) return null;
  if (task !== 'home' && task !== 'shelves' && Date.now() < retryAfter) return null;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  const ms = task === 'metadata' ? RECOMMENDATION_AI_ROUTING.metadataTimeoutMs : task === 'ranking' ? RECOMMENDATION_AI_ROUTING.rankingTimeoutMs : task === 'shelves' ? RECOMMENDATION_AI_ROUTING.shelvesTimeoutMs : RECOMMENDATION_AI_ROUTING.homeTimeoutMs;
  const timer = setTimeout(abort, ms);
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-vinax-client': isNativePlatform() ? 'app' : 'web' },
      body: JSON.stringify({ task, data }), signal: controller.signal,
    });
    if (res.status === 404 || res.status === 405) { routeMissingUntil = Date.now() + 10 * 60_000; return null; }
    if (!res.ok) throw new Error('Curator unavailable');
    return object(await res.json()).data ?? null;
  } catch {
    if (!signal?.aborted) retryAfter = Date.now() + 30_000;
    return null;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

/**
 * 7.2.0 — energy and tempo are measurements. They are kept only when the
 * server marked them `supplied` (it echoes a value this client sent, and
 * nulls anything a model made up) and, when the request is known, only when
 * they equal what was sent. An older server that does not mark provenance
 * therefore contributes no energy or tempo at all.
 */
function validate(raw: unknown, allowed: Set<string>, sent?: SentMeasurements): AiSongMetadata[] {
  const rows = Array.isArray(raw) ? raw : object(raw).songs;
  if (!Array.isArray(rows)) return [];
  const seen = new Set<string>();
  return rows.flatMap((value) => {
    const row = object(value);
    if (typeof row.id !== 'string' || !allowed.has(row.id) || seen.has(row.id)) return [];
    seen.add(row.id);
    const mood = label(row.mood);
    const supplied = fieldList(row.supplied, MEASURED);
    const mine = sent?.get(row.id);
    let energy = supplied.includes('energy') ? numeric(row.energy, 0, 1) : undefined;
    let tempo = supplied.includes('tempo') ? numeric(row.tempo, 40, 220) : undefined;
    if (sent && !sameMeasurement(energy, mine?.energy, 0.01)) energy = undefined;
    if (sent && !sameMeasurement(tempo, mine?.tempo, 1)) tempo = undefined;
    const kept = [...(energy !== undefined ? ['energy'] : []), ...(tempo !== undefined ? ['tempo'] : [])];
    return [{ id: row.id, mood: ['romantic', 'energetic', 'chill', 'melancholy', 'devotional', 'neutral'].includes(mood ?? '') ? mood : undefined,
      vibe: labels(row.vibe), genre: labels(row.genre), context: labels(row.context), language: label(row.language), dialect: label(row.dialect), subLanguage: label(row.subLanguage),
      energy, tempo, inferred: fieldList(row.inferred, INFERABLE), supplied: kept }];
  });
}
const fingerprint = (s: Song) => JSON.stringify([s.title, s.subtitle, s.language, s.artists.map(a => a.name), s.album?.name]);
function cached(): Record<string, Entry> {
  // Retired caches are never read; drop them so their invented values are gone.
  try { RETIRED_CACHE_KEYS.forEach((k) => { if (localStorage.getItem(k) !== null) localStorage.removeItem(k); }); } catch { /* storage is optional */ }
  try {
    const raw = object(JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}'));
    return Object.fromEntries(Object.entries(raw).filter(([, v]) => {
      const e = object(v); return typeof e.at === 'number' && e.at <= Date.now() && Date.now() - e.at < TTL && typeof e.fingerprint === 'string' && typeof object(e.metadata).id === 'string';
    })) as Record<string, Entry>;
  } catch { return {}; }
}
function hits(songs: Song[], store: Record<string, Entry>) {
  return songs.flatMap(song => {
    const entry = store[song.id];
    return entry?.fingerprint === fingerprint(song) ? validate([entry.metadata], new Set([song.id])) : [];
  });
}

export async function classifySongs(songs: Song[]): Promise<AiSongMetadata[]> {
  const found = hits(songs, cached());
  const ids = new Set(found.map(row => row.id));
  const missing = [...new Map(songs.filter(s => !ids.has(s.id)).map(s => [s.id, s])).values()].slice(0, 16);
  if (!missing.length) return found;
  const key = missing.map(s => s.id + fingerprint(s)).join('|');
  let job = pending.get(key);
  if (!job) {
    job = (async () => {
      const raw = await requestCurator('metadata', { songs: missing.map(s => ({ id: s.id, title: s.title.slice(0, 120), artists: s.artists.slice(0, 3).map(a => a.name), language: s.language, album: s.album?.name, energy: s.energy, tempo: s.tempo })) });
      const sent: SentMeasurements = new Map(missing.map(s => [s.id, { energy: s.energy, tempo: s.tempo }]));
      const rows = validate(raw, new Set(missing.map(s => s.id)), sent);
      const next = cached();
      rows.forEach(row => { next[row.id] = { at: Date.now(), fingerprint: fingerprint(missing.find(s => s.id === row.id)!), metadata: row }; });
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(Object.entries(next).sort((a, b) => b[1].at - a[1].at).slice(0, 500)))); } catch { /* storage is optional */ }
      return rows;
    })().finally(() => pending.delete(key));
    pending.set(key, job);
  }
  return [...found, ...await job];
}

export function applyMetadata(songs: Song[], metadata: AiSongMetadata[]): Song[] {
  const byId = new Map(metadata.map(m => [m.id, m]));
  return songs.map(song => {
    const m = byId.get(song.id); if (!m) return song;
    return { ...song, mood: song.mood ?? m.mood, dialect: song.dialect ?? m.dialect, subLanguage: song.subLanguage ?? m.subLanguage,
      genre: song.genre ?? m.genre?.[0], genres: [...new Set([...(song.genres ?? []), ...(m.genre ?? [])])],
      vibe: song.vibe ?? m.vibe?.[0], vibes: [...new Set([...(song.vibes ?? []), ...(m.vibe ?? [])])],
      energy: song.energy ?? m.energy, tempo: song.tempo ?? m.tempo, language: song.language ?? m.language ?? null };
  });
}

/**
 * Apply cached metadata immediately. Recommendation surfaces may opt into a
 * small wait window so a fast classifier can influence the current ranking;
 * the timeout is deliberately shorter than the full model deadline and never
 * blocks playback when the service is unavailable.
 */
export async function enrichSongs(songs: Song[], options: { waitMs?: number } = {}): Promise<Song[]> {
  const cachedRows = hits(songs, cached());
  const waitMs = Math.max(0, Math.min(2_000, Math.floor(options.waitMs ?? 0)));
  if (!waitMs) {
    void classifySongs(songs).catch(() => undefined);
    return applyMetadata(songs, cachedRows);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const classified = await Promise.race([
      classifySongs(songs),
      new Promise<AiSongMetadata[]>((resolve) => { timer = setTimeout(() => resolve([]), waitMs); }),
    ]);
    return applyMetadata(songs, [...cachedRows, ...classified]);
  } catch {
    void classifySongs(songs).catch(() => undefined);
    return applyMetadata(songs, cachedRows);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function aiRerankSongs(songs: Song[], context: string, limit: number): Promise<Song[]> {
  const take = Math.max(0, Math.min(40, Math.floor(limit)));
  if (songs.length < 3 || !take) return songs.slice(0, take);
  const raw = await requestCurator('ranking', { context: context.slice(0, 9000), songs: songs.slice(0, 40).map(s => ({ id: s.id, title: s.title, artist: s.artists[0]?.name, language: s.language, genres: s.genres, vibes: s.vibes, mood: s.mood, energy: s.energy, tempo: s.tempo })) });
  const ids = Array.isArray(raw) ? raw : object(raw).ids;
  if (!Array.isArray(ids)) return songs.slice(0, take);
  const byId = new Map(songs.map(s => [s.id, s]));
  const seen = new Set<string>();
  const ordered: Song[] = [];
  for (const id of ids) if (typeof id === 'string' && byId.has(id) && !seen.has(id)) { seen.add(id); ordered.push(byId.get(id)!); }
  return [...ordered, ...songs.filter(s => !seen.has(s.id))].slice(0, take);
}
