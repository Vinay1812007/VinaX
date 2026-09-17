import type { Song } from '@/types';
import { dedupeByIdentity, isJunkTitle, songKey } from './songIdentity';
import { isJunkTrack } from './quality';
import type { Candidate, RejectedCandidate, RejectReason } from './types';

/**
 * v7.0.0 — stage 2 of the next-song pipeline: hard filtering.
 *
 * Every rule here is a RULE, not a preference — a candidate that fails one
 * never reaches scoring, whatever the AI or the ranker thinks of it. Unlike
 * the older `freshSongs` gate (still used by emergency top-ups), this one
 * says WHY each candidate was turned away, so the developer breakdown can
 * show rejected songs next to selected ones, and it collapses versions of
 * one song onto the best cut instead of the first one seen.
 */
export interface HardFilterOptions {
  seed?: Song | null;
  /** Ids already in the queue (or otherwise spoken for). */
  queuedIds?: Set<string>;
  /** Canonical keys already in the queue. */
  queuedKeys?: Set<string>;
  /** Ids played recently (the profile's repetition guard). */
  recentIds?: Set<string>;
  /** Canonical keys played recently (catches another version of a recent song). */
  recentKeys?: Set<string>;
  /** Songs skipped in this sitting. */
  sessionSkippedIds?: Set<string>;
  mutedLanguages?: string[];
  blocked?: (song: Song) => boolean;
  /** Kid mode: explicit-flagged songs are out. */
  hideExplicit?: boolean;
}

export interface HardFilterResult {
  admitted: Candidate[];
  rejected: RejectedCandidate[];
}

export function rejectReasonFor(song: Song, o: HardFilterOptions): RejectReason | null {
  if (!song?.id || !song.title || !Array.isArray(song.artists)) return 'invalid';
  if (isJunkTitle(song.title) || isJunkTrack(song)) return 'junk';
  if (song.duration != null && song.duration > 0 && song.duration < 90) return 'too-short';
  if (o.hideExplicit && song.explicit) return 'explicit';
  if (o.blocked?.(song)) return 'blocked';
  if (song.language && o.mutedLanguages?.includes(song.language)) return 'muted-language';
  const key = songKey(song);
  if (o.seed && (song.id === o.seed.id || key === songKey(o.seed))) return 'seed';
  if (o.queuedIds?.has(song.id) || o.queuedKeys?.has(key)) return 'already-queued';
  if (o.recentIds?.has(song.id) || o.recentKeys?.has(key)) return 'recently-played';
  if (o.sessionSkippedIds?.has(song.id)) return 'skipped-this-session';
  return null;
}

export function hardFilter(candidates: Candidate[], options: HardFilterOptions = {}): HardFilterResult {
  const rejected: RejectedCandidate[] = [];
  const passed: Candidate[] = [];
  const seenIds = new Set<string>();
  for (const c of candidates) {
    const reason = rejectReasonFor(c.song, options);
    if (reason) {
      if (c.song?.id && !seenIds.has(c.song.id)) rejected.push({ song: c.song, reason, stage: 'filter' });
      if (c.song?.id) seenIds.add(c.song.id);
      continue;
    }
    if (seenIds.has(c.song.id)) continue; // the same catalogue id from two sources: keep the first, silently
    seenIds.add(c.song.id);
    passed.push(c);
  }
  const admitted = dedupeByIdentity(passed, (c) => c.song);
  if (admitted.length !== passed.length) {
    const kept = new Set(admitted.map((c) => c.song.id));
    for (const c of passed) if (!kept.has(c.song.id)) rejected.push({ song: c.song, reason: 'duplicate-version', stage: 'filter' });
  }
  return { admitted, rejected };
}
