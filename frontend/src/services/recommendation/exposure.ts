import type { Song } from '@/types';
import { songKey } from './songKey';

/**
 * 9.1.0 — ONE exposure ledger for every surface that puts a song in front of
 * the listener.
 *
 * Before 9.1 the same job was split across five device memories that did not
 * know about each other, each with its own key shape, cap and lifetime:
 *
 *   vinax.flow.served.v1          canonical keys, read by Home, the Daily mix
 *                                 and the AI Playlist — but WRITTEN by only the
 *                                 Home hero and the AI Playlist, so the queue,
 *                                 the DJ, Radio and every discovery shelf
 *                                 surfaced songs that nothing recorded.
 *   vinax.recs.seedmemo.v1        raw catalogue ids (an alternate release of
 *                                 the same song walked straight past it).
 *   vinax.dj.surfaced.v1          raw ids, prompt-only: never a filter.
 *   vinax.aiplaylist.avoid.v1     bare title strings, prompt-only.
 *   vinax.home.ai-shelves.songs.v1 raw ids, prompt-only.
 *
 * This module replaces all five as the SOURCE OF TRUTH. It keeps one row per
 * canonical identity (./identityCore's work family, so the film cut, the
 * remaster and the lofi flip of a song are one row) with a separate timestamp
 * per KIND of event, because the events mean different things:
 *
 *   shown      the listener could see it in a list. Cheap to repeat.
 *   queued     the automatic queue accepted it. It was about to play.
 *   played     playback passed the play threshold.
 *   completed  it ran to the end.
 *   skipped    the listener left early (counted, so three skips bite harder).
 *   liked      a favourite: repetition is the POINT, so it is forgiven.
 *   disliked   "not interested".
 *   replayed   the listener asked for it again on purpose: clears the cooling.
 *
 * What it deliberately does NOT record: a cancelled request, a model
 * suggestion that was rejected, or a prefetched song nobody saw. A surface
 * records `shown` when it renders, and the queue records `queued` when the
 * player accepts the songs — never when they are merely planned.
 *
 * Device-local, bounded, never uploaded, and the clock is only ever read
 * through a `now` argument's default so tests stay deterministic.
 */

export const EXPOSURE_KEY = 'vinax.recs.exposure.v1';
/** Rows kept. One row is ~60 bytes of JSON, so the whole ledger stays well under 64 KB. */
export const EXPOSURE_CAP = 600;
/** A row untouched for this long is forgotten. */
const ROW_TTL_MS = 45 * 86_400_000;

export type ExposureEvent =
  | 'shown'
  | 'queued'
  | 'played'
  | 'completed'
  | 'skipped'
  | 'liked'
  | 'disliked'
  | 'replayed';

/**
 * How long each kind of event keeps costing a song something, and how much it
 * costs at its freshest. The cost decays linearly to zero across the horizon.
 *
 * Sized against the rest of the score (a candidate's total is typically
 * 0.4–1.2, the strongest candidate-source boost is 0.24, a language match
 * 0.12): a song shown on another shelf this morning loses about as much as a
 * language mismatch, one the queue played yesterday loses more than any single
 * taste term, and one skipped twice this week is effectively out of contention
 * without being hard-filtered. 8.2's `servedRecently: 0.04` was too small to
 * change an order at all — it is what this replaces.
 */
export const EXPOSURE_WEIGHTS = Object.freeze({
  shown: { penalty: 0.14, horizonMs: 3 * 86_400_000, coolingMs: 12 * 3_600_000 },
  queued: { penalty: 0.24, horizonMs: 7 * 86_400_000, coolingMs: 2 * 86_400_000 },
  played: { penalty: 0.3, horizonMs: 10 * 86_400_000, coolingMs: 3 * 86_400_000 },
  completed: { penalty: 0.22, horizonMs: 14 * 86_400_000, coolingMs: 3 * 86_400_000 },
  /** Per skip, up to SKIP_STACK of them. A skip is the listener saying no. */
  skipped: { penalty: 0.3, horizonMs: 21 * 86_400_000, coolingMs: 14 * 86_400_000 },
  disliked: { penalty: 0.8, horizonMs: 60 * 86_400_000, coolingMs: 45 * 86_400_000 },
} as const);

/** Skips beyond this stop adding to the penalty. */
const SKIP_STACK = 3;
/**
 * A favourite's exposure costs this fraction of the usual: the listener wants
 * to hear it again, so "you played this yesterday" must not bury it.
 */
export const LIKED_FORGIVENESS = 0.25;
/** An explicit replay request wipes the cooling (and most of the penalty) for this long. */
const REPLAY_GRACE_MS = 7 * 86_400_000;

interface Row {
  k: string;
  /** shown, queued, played, completed, skipped, liked, disliked, replayed — epoch ms. */
  s?: number;
  q?: number;
  p?: number;
  c?: number;
  x?: number;
  /** Skip count (capped at SKIP_STACK). */
  xn?: number;
  l?: number;
  d?: number;
  r?: number;
  /** Most recent touch of any kind, for pruning. */
  at: number;
}

const FIELD: Record<Exclude<ExposureEvent, 'liked' | 'disliked' | 'replayed'>, 's' | 'q' | 'p' | 'c' | 'x'> = {
  shown: 's',
  queued: 'q',
  played: 'p',
  completed: 'c',
  skipped: 'x',
};

/** In-memory mirror, authoritative only while storage refuses writes. */
let mirror: Row[] = [];
let storageFailed = false;

function readRows(now: number): Row[] {
  let raw: unknown = storageFailed ? mirror : [];
  try {
    const stored = window.localStorage.getItem(EXPOSURE_KEY);
    // A missing key is an empty ledger: it was never written, or a reset
    // removed it. (8.x's served memory fell back to its in-memory copy here,
    // so "Erase everything" left the list alive until the next reload.)
    if (stored != null) raw = JSON.parse(stored);
  } catch {
    raw = mirror;
  }
  if (!Array.isArray(raw)) return [];
  const cutoff = now - ROW_TTL_MS;
  const out: Row[] = [];
  for (const e of raw) {
    if (!e || typeof e !== 'object') continue;
    const r = e as Row;
    if (typeof r.k !== 'string' || !r.k || !Number.isFinite(r.at) || r.at <= cutoff) continue;
    out.push(r);
    if (out.length >= EXPOSURE_CAP) break;
  }
  return out;
}

function writeRows(rows: Row[]): void {
  const kept = rows.slice(0, EXPOSURE_CAP);
  mirror = kept;
  try {
    window.localStorage.setItem(EXPOSURE_KEY, JSON.stringify(kept));
    storageFailed = false;
  } catch {
    storageFailed = true; // this session still remembers
  }
}

/* ---------- snooze: "not this song, for a while" ---------- */

export const SNOOZE_KEY = 'vinax.recs.snoozed.v1';
/** The durations the song menu offers, in days (the same choices as an artist soft mute). */
export const SNOOZE_DAYS = [7, 14, 30] as const;
export const DEFAULT_SNOOZE_DAYS = 14;
const SNOOZE_CAP = 300;
const MAX_SNOOZE_DAYS = 90;

interface SnoozeRow {
  k: string;
  /** Display title, so a list can show what was snoozed. */
  t: string;
  /** Epoch ms when it ends. */
  until: number;
}

export interface Snooze {
  key: string;
  title: string;
  until: number;
}

export interface SnoozeReceipt {
  snooze: Snooze;
  /** Lifts this snooze, exactly. Idempotent, and never touches another one. */
  undo(): void;
}

function readSnoozes(now: number): SnoozeRow[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(SNOOZE_KEY) || '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((e): e is SnoozeRow => !!e && typeof (e as SnoozeRow).k === 'string' && typeof (e as SnoozeRow).t === 'string' && Number.isFinite((e as SnoozeRow).until) && (e as SnoozeRow).until > now)
      .slice(0, SNOOZE_CAP);
  } catch {
    return [];
  }
}

function writeSnoozes(rows: SnoozeRow[]): void {
  try {
    window.localStorage.setItem(SNOOZE_KEY, JSON.stringify(rows.slice(0, SNOOZE_CAP)));
  } catch {
    /* a snooze the device cannot store simply does not happen */
  }
}

/**
 * 9.1.0 — "not this song, for a while": a per-SONG counterpart to the
 * per-artist soft mute that already exists
 * (services/personalization/softMutes.ts). Keyed by canonical identity, so
 * snoozing a song snoozes its remaster and its lofi flip too — which is what a
 * listener means.
 *
 * It is a HARD rule while it lasts (./filters.ts `snoozed`), not a penalty: the
 * listener asked for this song to go away, and a nudge would keep handing it
 * back. It expires by itself, and `undo()` lifts exactly this one.
 */
export function snoozeSong(song: Song, days = DEFAULT_SNOOZE_DAYS, now = Date.now()): SnoozeReceipt | null {
  const key = song?.id ? usableKey(song) : null;
  if (!key) return null;
  const span = Math.max(1, Math.min(MAX_SNOOZE_DAYS, Math.floor(days)));
  const rows = readSnoozes(now);
  const before = rows.find((r) => r.k === key);
  const row: SnoozeRow = { k: key, t: song.title.slice(0, 120), until: now + span * 86_400_000 };
  writeSnoozes([row, ...rows.filter((r) => r.k !== key)]);
  return {
    snooze: { key, title: row.t, until: row.until },
    undo: () => {
      const current = readSnoozes(Date.now());
      // Put back exactly what was there before — including an earlier snooze
      // this one replaced.
      writeSnoozes(before ? [before, ...current.filter((r) => r.k !== key)] : current.filter((r) => r.k !== key));
    },
  };
}

/** Lift a snooze by key. */
export function unsnooze(key: string, now = Date.now()): void {
  writeSnoozes(readSnoozes(now).filter((r) => r.k !== key));
}

/** Every live snooze, soonest to end first (Settings, the taste profile). */
export function snoozedSongs(now = Date.now()): Snooze[] {
  return readSnoozes(now)
    .map((r) => ({ key: r.k, title: r.t, until: r.until }))
    .sort((a, b) => a.until - b.until);
}

/** The canonical keys currently snoozed — a hard rule for every surface. */
export function snoozedKeySet(now = Date.now()): Set<string> {
  return new Set(readSnoozes(now).map((r) => r.k));
}

/** Tests, and "Erase everything": forget every exposure. */
export function resetExposure(): void {
  try {
    window.localStorage.removeItem(SNOOZE_KEY);
  } catch {
    /* nothing stored */
  }
  mirror = [];
  storageFailed = false;
  try {
    window.localStorage.removeItem(EXPOSURE_KEY);
  } catch {
    /* nothing stored */
  }
}

/**
 * Record an event for songs the listener really met. `shown` goes in when a
 * list renders; `queued` when the player accepts automatic entries; the
 * playback kinds come from the playback event bus (./transitionTracker.ts).
 */
/**
 * The canonical key of a song, or null when it has no usable identity.
 *
 * `canonicalKey` yields "title|artist", so a song with no title still produces
 * "|artist" — a key, but not an identity. Both halves have to be there, or two
 * untitled songs by one artist would collapse onto each other.
 */
function usableKey(song: Song): string | null {
  const key = songKey(song);
  const [title, artist] = key.split('|');
  return title && artist ? key : null;
}

export function recordExposure(songs: readonly Song[], event: ExposureEvent, now = Date.now()): void {
  const keys: string[] = [];
  for (const song of songs) {
    if (!song?.id) continue;
    const k = usableKey(song);
    if (k) keys.push(k);
  }
  recordExposureKeys(keys, event, now);
}

/** The same, for callers that already hold canonical keys. */
export function recordExposureKeys(keys: readonly string[], event: ExposureEvent, now = Date.now()): void {
  if (!keys.length) return;
  const rows = readRows(now);
  const byKey = new Map(rows.map((r) => [r.k, r]));
  const touched: Row[] = [];
  for (const k of new Set(keys)) {
    const row = byKey.get(k) ?? { k, at: now };
    byKey.set(k, row);
    row.at = now;
    if (event === 'liked') row.l = now;
    else if (event === 'disliked') row.d = now;
    else if (event === 'replayed') row.r = now;
    else {
      row[FIELD[event]] = now;
      if (event === 'skipped') row.xn = Math.min(SKIP_STACK, (row.xn ?? 0) + 1);
      // Finishing or asking for a song again answers an older skip.
      if (event === 'completed' || event === 'played') row.xn = 0;
    }
    touched.push(row);
  }
  const rest = rows.filter((r) => !touched.includes(r));
  // Newest first, so the cap drops the stalest rows.
  writeRows([...touched, ...rest]);
}

/** A song the listener asked to hear again: its cooling is lifted. */
export function recordReplayRequest(song: Song, now = Date.now()): void {
  recordExposure([song], 'replayed', now);
}

const decay = (age: number, horizon: number): number => (age >= horizon ? 0 : 1 - age / horizon);

export interface ExposureLedger {
  /**
   * What this song's recent exposure should cost it, in score units (0 when
   * it is new to the listener). Favourites pay a quarter; a song the listener
   * explicitly asked to replay pays nothing for a week.
   */
  penalty(key: string): number;
  /**
   * True while a song is still cooling: a discovery surface should leave it
   * out rather than merely rank it down. Never true for a favourite, a song
   * the listener asked to replay, or one they have never met.
   */
  cooling(key: string): boolean;
  /** Identities with any exposure at all (shown anywhere, played, queued…). */
  readonly keys: ReadonlySet<string>;
  /** Identities the listener skipped at least once inside the skip horizon. */
  readonly skippedKeys: ReadonlySet<string>;
  /** Identities shown on some surface inside the shown horizon. */
  readonly shownKeys: ReadonlySet<string>;
  /** How many rows the ledger holds (diagnostics). */
  readonly size: number;
}

/**
 * Read the ledger once and answer about many songs. Callers that place a list
 * should take ONE snapshot and reuse it, so a long list cannot reorder under
 * its own feet.
 */
export function exposureLedger(now = Date.now()): ExposureLedger {
  const rows = readRows(now);
  const byKey = new Map(rows.map((r) => [r.k, r]));
  const keys = new Set(byKey.keys());
  const skippedKeys = new Set<string>();
  const shownKeys = new Set<string>();
  for (const r of rows) {
    if (r.x != null && now - r.x < EXPOSURE_WEIGHTS.skipped.horizonMs) skippedKeys.add(r.k);
    if (r.s != null && now - r.s < EXPOSURE_WEIGHTS.shown.horizonMs) shownKeys.add(r.k);
  }
  const forgiveness = (r: Row): number => {
    if (r.r != null && now - r.r < REPLAY_GRACE_MS) return 0;
    if (r.l != null) return LIKED_FORGIVENESS;
    return 1;
  };
  const penalty = (key: string): number => {
    const r = byKey.get(key);
    if (!r) return 0;
    const f = forgiveness(r);
    if (f === 0) return 0;
    let total = 0;
    const W = EXPOSURE_WEIGHTS;
    if (r.s != null) total += W.shown.penalty * decay(now - r.s, W.shown.horizonMs);
    if (r.q != null) total += W.queued.penalty * decay(now - r.q, W.queued.horizonMs);
    if (r.p != null) total += W.played.penalty * decay(now - r.p, W.played.horizonMs);
    if (r.c != null) total += W.completed.penalty * decay(now - r.c, W.completed.horizonMs);
    if (r.x != null) total += W.skipped.penalty * Math.min(SKIP_STACK, r.xn ?? 1) * decay(now - r.x, W.skipped.horizonMs);
    if (r.d != null) total += W.disliked.penalty * decay(now - r.d, W.disliked.horizonMs);
    return total * f;
  };
  const cooling = (key: string): boolean => {
    const r = byKey.get(key);
    if (!r || forgiveness(r) !== 1) return false;
    const W = EXPOSURE_WEIGHTS;
    return (
      (r.s != null && now - r.s < W.shown.coolingMs) ||
      (r.q != null && now - r.q < W.queued.coolingMs) ||
      (r.p != null && now - r.p < W.played.coolingMs) ||
      (r.c != null && now - r.c < W.completed.coolingMs) ||
      (r.x != null && now - r.x < W.skipped.coolingMs) ||
      (r.d != null && now - r.d < W.disliked.coolingMs)
    );
  };
  return { penalty, cooling, keys, skippedKeys, shownKeys, size: rows.length };
}

/** The ledger as counts, for the owner diagnostics view. */
export interface ExposureStats {
  rows: number;
  shown: number;
  queued: number;
  played: number;
  skipped: number;
  cooling: number;
  oldestAt: number | null;
}

export function exposureStats(now = Date.now()): ExposureStats {
  const rows = readRows(now);
  const ledger = exposureLedger(now);
  let shown = 0;
  let queued = 0;
  let played = 0;
  let skipped = 0;
  let cooling = 0;
  let oldestAt: number | null = null;
  for (const r of rows) {
    if (r.s != null) shown += 1;
    if (r.q != null) queued += 1;
    if (r.p != null) played += 1;
    if (r.x != null) skipped += 1;
    if (ledger.cooling(r.k)) cooling += 1;
    if (oldestAt == null || r.at < oldestAt) oldestAt = r.at;
  }
  return { rows: rows.length, shown, queued, played, skipped, cooling, oldestAt };
}

/* ---------- migration from the five 8.x/9.0 memories ---------- */

export const MIGRATION_FLAG = 'vinax.recs.exposure.migrated.v1';
/** The keys 9.0 and earlier wrote. Read once, then left alone. */
export const LEGACY_KEYS = Object.freeze({
  served: 'vinax.flow.served.v1',
  djSurfaced: 'vinax.dj.surfaced.v1',
  homeShown: 'vinax.home.ai-shelves.songs.v1',
} as const);

/**
 * Carry the 9.0 memories into the ledger, once per device.
 *
 * `vinax.flow.served.v1` already held canonical keys with timestamps, so it
 * transfers exactly as `shown`. The DJ's and Home's lists held catalogue IDS
 * and no timestamps — an id cannot be turned into a canonical key without the
 * song, so those two are NOT imported; they stay on disk untouched (the DJ
 * still reads its own list for its prompt) and the ledger simply starts
 * without them. Nothing the listener can see is lost: the served list is the
 * one those surfaces were actually filtered by.
 */
export function migrateLegacyExposure(now = Date.now()): { imported: number; already: boolean } {
  try {
    if (window.localStorage.getItem(MIGRATION_FLAG) === '1') return { imported: 0, already: true };
  } catch {
    return { imported: 0, already: true }; // no storage: nothing to migrate from
  }
  let imported = 0;
  try {
    const raw = JSON.parse(window.localStorage.getItem(LEGACY_KEYS.served) || '[]') as unknown;
    if (Array.isArray(raw)) {
      const rows = readRows(now);
      const byKey = new Map(rows.map((r) => [r.k, r]));
      for (const e of raw) {
        const entry = e as { k?: unknown; t?: unknown };
        if (typeof entry?.k !== 'string' || !entry.k || !Number.isFinite(entry.t)) continue;
        const at = Number(entry.t);
        if (at > now || now - at > ROW_TTL_MS) continue;
        const row = byKey.get(entry.k) ?? { k: entry.k, at };
        // Never move a timestamp forward: a fresher ledger row wins.
        row.s = Math.max(row.s ?? 0, at);
        row.at = Math.max(row.at, at);
        byKey.set(entry.k, row);
        imported += 1;
      }
      if (imported) writeRows([...byKey.values()].sort((a, b) => b.at - a.at));
    }
  } catch {
    /* a malformed legacy list simply imports nothing */
  }
  try {
    window.localStorage.setItem(MIGRATION_FLAG, '1');
  } catch {
    /* the flag is a convenience; a re-run is idempotent (Math.max above) */
  }
  return { imported, already: false };
}
