import type { Song } from '@/types';
import { inferMood, type Mood } from '@/services/recommendation/mood';

/**
 * Package A1 — the session vector.
 *
 * A rolling window of the last N songs the listener actually played THIS
 * browsing session, so recommendations can follow the current mood arc
 * on the device. Three sad songs in a row nudge the next pick
 * sadder; a Telugu run keeps the momentum Telugu — all computed locally
 * from the window, all reset when the tab closes (sessionStorage, not
 * localStorage: "session" means the browsing session, not forever).
 *
 * This is deliberately separate from the decayed TasteProfile: the profile
 * is who you are over weeks; the session vector is what you're in the mood
 * for right now. The scorer blends the session vector in at a gentle ~0.10
 * so it colours the order without overriding long-term taste.
 */

const KEY = 'vinax.session.window.v1';
const WINDOW = 10;

interface WindowEntry {
  mood: Mood;
  energy: number; // 0..1
  language: string | null;
  hour: number;
}

/** Coarse energy per mood — no audio analysis available, so we map the
 *  keyword-inferred mood onto an energy axis. Energetic songs sit high,
 *  melancholy low; neutral stays mid so it never skews a run. */
const MOOD_ENERGY: Record<Mood, number> = {
  energetic: 0.9,
  romantic: 0.55,
  devotional: 0.45,
  chill: 0.25,
  melancholy: 0.15,
  neutral: 0.5,
};

/** Energy of a single song, from its inferred mood. Exported so the scorer
 *  can score a candidate on the same axis the window is built from. */
export function energyOfSong(song: Song | null | undefined): number {
  return MOOD_ENERGY[inferMood(song)];
}

function readWindow(): WindowEntry[] {
  try {
    if (typeof window === 'undefined') return [];
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? (arr as WindowEntry[]) : [];
  } catch {
    return [];
  }
}

function writeWindow(entries: WindowEntry[]): void {
  try {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem(KEY, JSON.stringify(entries.slice(-WINDOW)));
  } catch {
    /* sessionStorage disabled — the vector just stays empty, scorer no-ops */
  }
}

/** Record a play into the rolling window. Called from recordPlay so every
 *  real play (not queue-adds, not skips) feeds the current-mood arc. */
export function recordSessionPlay(song: Song): void {
  if (!song) return;
  const mood = inferMood(song);
  const entry: WindowEntry = {
    mood,
    energy: MOOD_ENERGY[mood],
    language: song.language ?? null,
    hour: new Date().getHours(),
  };
  const win = readWindow();
  win.push(entry);
  writeWindow(win);
}

export interface SessionVector {
  /** Dominant mood across the window (most frequent non-neutral, else neutral). */
  mood: Mood | null;
  /** Mean energy 0..1 across the window. */
  energy: number | null;
  /** Dominant language across the window (most frequent). */
  language: string | null;
  /** How many songs the vector is built from (0 = cold, weight it lightly). */
  size: number;
}

const EMPTY_VECTOR: SessionVector = { mood: null, energy: null, language: null, size: 0 };

/** Compute the current session vector from the rolling window. Returns a
 *  cold vector (all null, size 0) when nothing has played this session.
 *  (The old manual mood pin that overrode this is gone: steering is Tune this
 *  queue's job now.) */
export function getSessionVector(): SessionVector {
  const win = readWindow();
  if (!win.length) return EMPTY_VECTOR;

  // Dominant mood — most frequent, ignoring 'neutral' unless it's all we have.
  const moodCounts = new Map<Mood, number>();
  const langCounts = new Map<string, number>();
  let energySum = 0;
  for (const e of win) {
    if (e.mood !== 'neutral') moodCounts.set(e.mood, (moodCounts.get(e.mood) ?? 0) + 1);
    if (e.language) langCounts.set(e.language, (langCounts.get(e.language) ?? 0) + 1);
    energySum += typeof e.energy === 'number' ? e.energy : 0.5;
  }
  const topMood = [...moodCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'neutral';
  const topLang = [...langCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return {
    mood: topMood,
    energy: energySum / win.length,
    language: topLang,
    size: win.length,
  };
}

/** Clear the window — used when the listener explicitly asks for a reset
 *  (e.g. pull-to-refresh) so a fresh mood arc can start. */
export function clearSessionVector(): void {
  try {
    if (typeof window === 'undefined') return;
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
