import type { Song } from '@/types';
import { songKey } from '@/services/recommendation/songIdentity';
import { EXPOSURE_WEIGHTS, recordExposure, type ExposureLedger } from '@/services/recommendation/exposure';

/**
 * 10.1 Flow — the feed's list rules, kept pure so they are testable.
 *
 * The feed is APPEND-ONLY: sources answer at different times (the Daily mix
 * from cache at once, "because you liked" a moment later, the endless pages
 * as the listener scrolls), and a card the listener is looking at must never
 * move. New songs only ever join the end.
 */

/** A song Flow can actually play: it has at least one audio source. */
export function hasAudio(song: Song | null | undefined): song is Song {
  return !!song && Array.isArray(song.audio) && song.audio.some((a) => !!a?.url);
}

/** Round-robin across the sources, so one source never fills a whole stretch. */
export function interleave(sources: ReadonlyArray<readonly Song[] | undefined>): Song[] {
  const lists = sources.filter((s): s is readonly Song[] => !!s?.length);
  const out: Song[] = [];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest; i += 1) for (const l of lists) if (l[i]) out.push(l[i]);
  return out;
}

/**
 * More exposure than a fresh "shown" costs means the listener HEARD it (or the
 * queue took it) lately: Flow leaves it out. A favourite pays a quarter, so a
 * liked song can come back; a song only shown on a shelf stays, after fresh ones.
 */
export const FLOW_PENALTY_CUTOFF = EXPOSURE_WEIGHTS.shown.penalty;

export interface AppendOptions {
  /** Current safety rules (Kid mode, hidden, muted…): a forbidden song never joins. */
  allowed: (song: Song) => boolean;
  /** One ledger snapshot for the visit: songs met elsewhere lately are left out or sent back. */
  ledger?: Pick<ExposureLedger, 'penalty' | 'skippedKeys'> | null;
}

/**
 * The feed after `incoming` arrives: `current` unchanged, then the new songs
 * that are playable, allowed, not already in the feed (by canonical identity,
 * so a remaster of a song already shown does not follow it), and not skipped
 * or heard lately. Songs only SHOWN elsewhere stay, after the fresh ones.
 */
export function appendFeed(current: readonly Song[], incoming: readonly Song[], opts: AppendOptions): Song[] {
  const keys = new Set(current.map(songKey));
  const ids = new Set(current.map((s) => s.id));
  const fresh: Song[] = [];
  const met: Song[] = [];
  for (const song of incoming) {
    if (!hasAudio(song) || ids.has(song.id) || !opts.allowed(song)) continue;
    const key = songKey(song);
    if (keys.has(key)) continue;
    const penalty = opts.ledger?.penalty(key) ?? 0;
    if (opts.ledger?.skippedKeys.has(key) || penalty > FLOW_PENALTY_CUTOFF) continue;
    keys.add(key);
    ids.add(song.id);
    (penalty > 0 ? met : fresh).push(song);
  }
  return fresh.length || met.length ? [...current, ...fresh, ...met] : (current as Song[]);
}

/**
 * Exposure for Flow, per the ledger's contract (services/recommendation/exposure.ts):
 * a card is an impression when it SETTLES on screen, not when it is fetched
 * or rendered off-screen below. Each song is recorded once per visit.
 */
export function createShownRecorder(record: typeof recordExposure = recordExposure): (song: Song) => boolean {
  const done = new Set<string>();
  return (song) => {
    if (!song?.id || done.has(song.id)) return false;
    done.add(song.id);
    record([song], 'shown');
    return true;
  };
}
