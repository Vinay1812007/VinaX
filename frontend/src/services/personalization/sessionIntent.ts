import type { Song } from '@/types';
import { energyOfSong } from './session';

/**
 * v7.0.0 — session intent: what the listener is doing RIGHT NOW, kept apart
 * from the decayed TasteProfile (who they are over weeks).
 *
 * A short ring of this sitting's actions — skips, completions, likes, hand
 * queue-adds, plays started from a search — is reduced to a bounded read:
 * skip and completion streaks, the artists and languages being pushed away
 * or pulled in, which way the energy is being steered, and how much appetite
 * for discovery the behaviour shows. The scorer and the sequencer read it;
 * nothing here is ever written into the long-term profile, and it dies with
 * the tab (sessionStorage) or after a 45-minute silence.
 *
 * Pure reducers (`deriveIntent`) are exported so ranking tests can feed a
 * fixed list of events instead of touching storage.
 */
export type SessionEventType = 'skip' | 'complete' | 'like' | 'unlike' | 'queue_add' | 'search_play';

export interface SessionEvent {
  t: number;
  type: SessionEventType;
  /** Lower-cased lead artist ('' when unknown). */
  artist: string;
  language: string | null;
  /** 0..1 on the same axis the session window uses. */
  energy: number;
  songId: string;
}

export interface SessionIntent {
  /** Consecutive skips ending at the most recent play verdict. */
  skipStreak: number;
  /** Consecutive completions ending at the most recent play verdict. */
  completionStreak: number;
  /** artist → signed pull (−1..1): negative = being skipped this sitting, positive = liked / queued / searched. */
  artistPull: Record<string, number>;
  /** language → signed pull (−0.6..0.6): languages move slower and less far than artists. */
  languagePull: Record<string, number>;
  /** Songs skipped this sitting (never re-offered while it lasts). */
  skippedSongIds: Set<string>;
  /** Signed energy steer (−0.3..0.3): completed energy minus skipped energy, when both exist. */
  energySteer: number;
  /** −1..1: negative = wants the familiar (skip streak), positive = open to new things (long completion run). */
  discoveryAppetite: number;
  /** How many events the read is built from (0 = cold; consumers weight it lightly). */
  size: number;
}

const KEY = 'vinax.session.intent.v1';
const CAP = 40;
/** A sitting ends after this much silence; older events no longer describe "now". */
const SITTING_GAP_MS = 45 * 60_000;
/** An action this old counts for half of a fresh one. */
const FADE_MS = 30 * 60_000;
const LANGUAGE_PULL_MAX = 0.6;

export const EMPTY_INTENT: SessionIntent = Object.freeze({
  skipStreak: 0,
  completionStreak: 0,
  artistPull: {},
  languagePull: {},
  skippedSongIds: new Set<string>(),
  energySteer: 0,
  discoveryAppetite: 0,
  size: 0,
});

let memory: SessionEvent[] = [];

const leadArtist = (s: Song): string => (s.artists?.[0]?.name ?? s.subtitle?.split(',')[0] ?? '').trim().toLowerCase();

function isEvent(v: unknown): v is SessionEvent {
  if (!v || typeof v !== 'object') return false;
  const e = v as Partial<SessionEvent>;
  return typeof e.t === 'number' && Number.isFinite(e.t) && typeof e.type === 'string' && typeof e.artist === 'string' && typeof e.songId === 'string' && typeof e.energy === 'number';
}

function read(): SessionEvent[] {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parsed.filter(isEvent).slice(-CAP);
    }
  } catch {
    /* sessionStorage blocked or corrupt — fall back to the in-memory ring */
  }
  return memory;
}

function write(events: SessionEvent[]): void {
  memory = events.slice(-CAP);
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(memory));
  } catch {
    /* in-memory ring still works */
  }
}

/** Record one action of this sitting. Cheap, synchronous, never throws. */
export function noteSessionEvent(type: SessionEventType, song: Song, now = Date.now()): void {
  if (!song?.id) return;
  const events = read().filter((e) => now - e.t <= SITTING_GAP_MS * 4);
  events.push({ t: now, type, artist: leadArtist(song), language: song.language && song.language !== 'unknown' ? song.language : null, energy: energyOfSong(song), songId: song.id });
  write(events);
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

const PULL: Record<SessionEventType, number> = { skip: -0.4, complete: 0.15, like: 0.5, unlike: -0.3, queue_add: 0.35, search_play: 0.45 };

/** Pure: reduce a list of events (oldest first) to the intent as of `now`. */
export function deriveIntent(events: SessionEvent[], now = Date.now()): SessionIntent {
  // Only the current sitting: walk back from the newest event until a long silence.
  const ordered = events.filter((e) => e.t <= now).sort((a, b) => a.t - b.t);
  let start = ordered.length;
  let edge = now;
  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    if (edge - ordered[i].t > SITTING_GAP_MS) break;
    edge = ordered[i].t;
    start = i;
  }
  const sitting = ordered.slice(start);
  if (!sitting.length) return EMPTY_INTENT;

  let skipStreak = 0;
  let completionStreak = 0;
  for (let i = sitting.length - 1; i >= 0; i -= 1) {
    const type = sitting[i].type;
    if (type !== 'skip' && type !== 'complete') continue; // likes and queue-adds do not break a streak
    if (type === 'skip' && completionStreak === 0) skipStreak += 1;
    else if (type === 'complete' && skipStreak === 0) completionStreak += 1;
    else break;
  }

  const artistPull: Record<string, number> = {};
  const languagePull: Record<string, number> = {};
  const skippedSongIds = new Set<string>();
  let doneSum = 0;
  let doneN = 0;
  let skipSum = 0;
  let skipN = 0;
  let explicitPulls = 0;
  for (const e of sitting) {
    // Newer actions count more: a skip half an hour ago is half a skip now.
    const age = Math.min(1, (sitting[sitting.length - 1].t - e.t) / FADE_MS);
    const w = PULL[e.type] * (1 - 0.5 * age);
    if (e.artist) artistPull[e.artist] = clamp((artistPull[e.artist] ?? 0) + w, -1, 1);
    // Languages move slower than artists: one skipped song is not a verdict on a language.
    // It also stops short of the artist's range, so a run of skips inside one language never reads as "not this language".
    if (e.language) languagePull[e.language] = clamp((languagePull[e.language] ?? 0) + w * 0.4, -LANGUAGE_PULL_MAX, LANGUAGE_PULL_MAX);
    if (e.type === 'skip') {
      skippedSongIds.add(e.songId);
      skipSum += e.energy;
      skipN += 1;
    } else if (e.type === 'complete') {
      skippedSongIds.delete(e.songId);
      doneSum += e.energy;
      doneN += 1;
    } else if (e.type === 'search_play' || e.type === 'queue_add') {
      explicitPulls += 1;
    }
  }
  const energySteer = doneN >= 2 && skipN >= 2 ? clamp(doneSum / doneN - skipSum / skipN, -0.3, 0.3) : 0;
  // Skip streaks ask for safer ground; a long run of completions earns room to explore.
  // A listener who keeps searching and hand-queueing knows what they want: lean familiar.
  const discoveryAppetite = clamp((completionStreak >= 4 ? 0.2 + 0.1 * Math.min(4, completionStreak - 4) : 0) - (skipStreak >= 2 ? 0.3 + 0.15 * Math.min(4, skipStreak - 2) : 0) - Math.min(0.3, explicitPulls * 0.1), -1, 1);
  return { skipStreak, completionStreak, artistPull, languagePull, skippedSongIds, energySteer, discoveryAppetite, size: sitting.length };
}

/** The live intent for this tab. */
export function getSessionIntent(now = Date.now()): SessionIntent {
  if (typeof window === 'undefined') return EMPTY_INTENT;
  return deriveIntent(read(), now);
}

/** Test hook / explicit "start over" (pull-to-refresh discovery). */
export function resetSessionIntent(): void {
  memory = [];
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
