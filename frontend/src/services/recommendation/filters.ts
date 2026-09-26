import type { Song } from '@/types';
import type { TasteProfile } from '@/services/personalization/profile';
import { dedupeByIdentity, isJunkTitle, songKey } from './songIdentity';
import { isJunkTrack } from './quality';
import { softMutedArtist } from './profiles';
import { mergeCandidates, type Candidate, type RejectedCandidate, type RejectReason, type SongFeature } from './types';

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

/**
 * 7.2.0 — the listener-safety subset of the hard rules: what must never be
 * shown or played, whoever produced the list and however old the cache is.
 * Home's cached shelves apply exactly this set when they render.
 */
export interface SafetyRules {
  mutedLanguages?: string[];
  blocked?: (song: Song) => boolean;
  /** Kid mode: explicit-flagged songs are out. */
  hideExplicit?: boolean;
  /** "Show fewer like this" (the taste profile's `softMuted`); an entry holds until its `until`. */
  softMuted?: TasteProfile['softMuted'];
  /** Clock for the soft-mute expiry. Default `Date.now()`. */
  now?: number;
}

export interface HardFilterOptions extends SafetyRules {
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
  /**
   * 8.1.0 — under the 'mix' language policy: the languages a stretch may
   * draw from (the seed's, the listener's pinned and most-played). A song in
   * a known language outside this list is rejected as 'off-language'; a song
   * with no known language passes.
   */
  allowedLanguages?: ReadonlySet<string>;
}

export interface HardFilterResult {
  admitted: Candidate[];
  rejected: RejectedCandidate[];
}

export function safetyReasonFor(song: Song, o: SafetyRules): RejectReason | null {
  if (o.hideExplicit && song.explicit) return 'explicit';
  if (o.blocked?.(song)) return 'blocked';
  if (song.language && o.mutedLanguages?.includes(song.language)) return 'muted-language';
  if (softMutedArtist(song, o.softMuted, o.now)) return 'soft-muted';
  return null;
}

export function rejectReasonFor(song: Song, o: HardFilterOptions): RejectReason | null {
  if (!song?.id || !song.title || !Array.isArray(song.artists)) return 'invalid';
  if (isJunkTitle(song.title) || isJunkTrack(song)) return 'junk';
  if (song.duration != null && song.duration > 0 && song.duration < 90) return 'too-short';
  const unsafe = safetyReasonFor(song, o);
  if (unsafe) return unsafe;
  const key = songKey(song);
  if (o.seed && (song.id === o.seed.id || key === songKey(o.seed))) return 'seed';
  if (o.queuedIds?.has(song.id) || o.queuedKeys?.has(key)) return 'already-queued';
  if (o.recentIds?.has(song.id) || o.recentKeys?.has(key)) return 'recently-played';
  if (o.sessionSkippedIds?.has(song.id)) return 'skipped-this-session';
  // 8.1.0 — the mix policy admits the listener's languages, never a stranger's.
  if (o.allowedLanguages && song.language && song.language !== 'unknown' && !o.allowedLanguages.has(song.language)) return 'off-language';
  return null;
}

/**
 * 7.2.0 — the features the classifier added: present on `after` (the
 * enriched song), absent on `before` (the catalogue's). The pipeline stores
 * them as `Candidate.classified` so the scorer trusts them less than catalogue
 * metadata. Lives here, in the lazily loaded rules module, because the engine
 * already holds this module when it enriches.
 */
export function classifiedFields(before: Song, after: Song): SongFeature[] {
  const out: SongFeature[] = [];
  const empty = (v: unknown): boolean => v == null || v === '' || (Array.isArray(v) && !v.length);
  const added = (a: unknown, b: unknown): boolean => empty(a) && !empty(b);
  if (added(before.mood, after.mood)) out.push('mood');
  if (added(before.energy, after.energy)) out.push('energy');
  if (added(before.tempo, after.tempo)) out.push('tempo');
  if (added(before.genre || before.genres, after.genre || after.genres)) out.push('genre');
  if (added(before.vibe || before.vibes, after.vibe || after.vibes)) out.push('vibe');
  if (added(before.dialect, after.dialect)) out.push('dialect');
  return out;
}

export function hardFilter(candidates: Candidate[], options: HardFilterOptions = {}): HardFilterResult {
  const rejected: RejectedCandidate[] = [];
  const passed: Candidate[] = [];
  // 7.2.0 — the same catalogue id from several sources is ONE candidate that
  // keeps every source (it used to keep the first and drop the rest silently).
  for (const c of mergeCandidates(candidates)) {
    const reason = rejectReasonFor(c.song, options);
    if (!reason) passed.push(c);
    else if (c.song?.id) rejected.push({ song: c.song, reason, stage: 'filter' }); // a record with no id has nothing to show
  }
  const admitted = dedupeByIdentity(passed, (c) => c.song);
  if (admitted.length !== passed.length) {
    const kept = new Set(admitted.map((c) => c.song.id));
    for (const c of passed) if (!kept.has(c.song.id)) rejected.push({ song: c.song, reason: 'duplicate-version', stage: 'filter' });
  }
  return { admitted, rejected };
}
