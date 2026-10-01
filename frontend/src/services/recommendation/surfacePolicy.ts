import type { HistoryEntry, Song } from '@/types';
import { songKey } from './songIdentity';

/**
 * 9.0.0 — one set of repetition rules for every place VinaX puts songs in
 * front of the listener, with each surface's own purpose kept.
 *
 * SAFETY is not decided here and never varies by surface: Kid mode, muted
 * languages, hidden songs and artists, the server blocklist and "Less like
 * this" apply everywhere, at render, on cached lists too
 * (features/home/useShelfSafety.ts), and as hard rules in the queue
 * (./filters.ts).
 *
 * What differs per surface is how a list treats songs the listener has just
 * heard, skipped or been shown:
 *
 *   resume     Continue listening, Recently played, On repeat, Most listened,
 *              On this day, Repeat rewind, Recently liked. Recent plays ARE the
 *              content, so nothing is moved or removed.
 *   personal   Made For You and the Daily mix, Because you liked / listened
 *              to, For you this week, Your top genres. Taste-led picks: a song
 *              heard in the last stretch, skipped this sitting, or shown on
 *              another surface this week goes to the back of the shelf. It is
 *              never removed, so a short personal shelf is never emptied.
 *   discovery  Trending, new releases, popular picks, fresh finds, hidden gems,
 *              mood, genre and AI-designed shelves. Songs heard in the last
 *              stretch or skipped this sitting are removed; songs shown on
 *              another surface this week go to the back.
 *   queue      The automatic queue (./engine.ts). Recently played, skipped this
 *              sitting and already queued are hard rules there, and a song
 *              shown elsewhere costs a small score penalty — the strictest of
 *              all, because it plays without asking.
 *
 * Before 9.0 each Home hook made up its own rule: the Daily mix removed every
 * served song and kept recent plays, "Because you liked" kept everything,
 * the trending shelves kept recent plays and served songs alike.
 */
export type SurfaceKind = 'resume' | 'personal' | 'discovery';

export interface SurfaceSignals {
  /** Canonical identities of the last RECENT_WINDOW plays (the queue's recently-played window). */
  recentKeys: ReadonlySet<string>;
  /** Songs skipped in this sitting (the session intent). */
  sittingSkippedIds: ReadonlySet<string>;
  /** Identities another surface showed in the last week. */
  servedKeys: ReadonlySet<string>;
}

/** The queue's recently-played window, in plays (./engine.ts uses the same 20). */
export const RECENT_WINDOW = 20;

export const NO_SIGNALS: SurfaceSignals = { recentKeys: new Set(), sittingSkippedIds: new Set(), servedKeys: new Set() };

/** Build the signals from the listener's state (pure; callers pass the stores' values). */
export function surfaceSignals(history: readonly HistoryEntry[], sittingSkippedIds: Iterable<string>, servedKeys: Iterable<string>): SurfaceSignals {
  const recentKeys = new Set<string>();
  for (const e of history.slice(0, RECENT_WINDOW)) if (e?.song) recentKeys.add(songKey(e.song));
  return { recentKeys, sittingSkippedIds: new Set(sittingSkippedIds), servedKeys: new Set(servedKeys) };
}

/**
 * A list as `kind` should show it: songs in their original order, with the
 * surface's repetition rule applied (see above). Stable: songs keep their
 * relative order inside each group.
 */
export function surfaceOrder<T extends Song>(songs: readonly T[], kind: SurfaceKind, signals: SurfaceSignals): T[] {
  if (kind === 'resume') return [...songs];
  const fresh: T[] = [];
  const back: T[] = [];
  for (const song of songs) {
    if (!song?.id) continue;
    const key = songKey(song);
    const heard = signals.recentKeys.has(key) || signals.sittingSkippedIds.has(song.id);
    if (heard && kind === 'discovery') continue;
    if (heard || signals.servedKeys.has(key)) back.push(song);
    else fresh.push(song);
  }
  return [...fresh, ...back];
}
