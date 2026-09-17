import type { Song } from '@/types';
import { songKey } from './songIdentity';
import { rejectReasonFor, type HardFilterOptions } from './filters';
import type { RejectedCandidate } from './types';

/**
 * v7.0.0 — the last stage of the next-song pipeline: validate the sequence
 * that is about to be queued, whoever ordered it.
 *
 * The local sequencer already spaces artists and honours the language lock,
 * but the AI DJ returns its own order, discoveries arrive from a catalogue
 * search, and the short-pool top-up appends in rank order. None of them may
 * bypass the rules, so the final list is checked once more, in code:
 *
 *   1. every song passes the hard filter again (mute, block, explicit, junk,
 *      already queued / recently played / skipped this sitting);
 *   2. one song per canonical identity;
 *   3. under a language lock, off-language songs are dropped — unless that
 *      would leave the queue with almost nothing, in which case languages
 *      the listener actually plays are let back in before anything else;
 *   4. one lead artist fills at most `artistCap` of the slots, relaxed only
 *      when the pool is too small to fill the queue otherwise;
 *   5. no lead artist twice in a row (the seed counts as the previous song):
 *      a later song is pulled forward to break the pair when one exists.
 *
 * Order is otherwise preserved, so an accepted arc stays an arc.
 */
export interface ValidateOptions extends HardFilterOptions {
  limit: number;
  /** The queue's language under a 'lock' policy; null = no lock. */
  lockLanguage?: string | null;
  /** Languages the listener plays: the first fallback when a locked queue runs short. */
  familiarLanguages?: string[];
  /** Fewest songs worth shipping before a rule is relaxed. */
  minimum?: number;
  /** Max songs per lead artist; default ⌈limit / 4⌉ (two in a queue of eight). */
  artistCap?: number;
}

export interface ValidateResult {
  songs: Song[];
  rejected: RejectedCandidate[];
  /** Songs moved to break a same-artist pair. */
  repairs: number;
  /** Rules that had to be relaxed to fill the queue. */
  relaxed: Array<'language-lock' | 'artist-cap'>;
}

const leadOf = (s: Song | null | undefined): string => (s?.artists?.[0]?.name ?? s?.subtitle?.split(',')[0] ?? '').trim().toLowerCase();
const speaks = (s: Song, language: string): boolean => !s.language || s.language === 'unknown' || s.language === language;

export function validateSequence(order: Song[], options: ValidateOptions): ValidateResult {
  const limit = Math.max(0, Math.floor(options.limit));
  const minimum = Math.min(limit, options.minimum ?? 3);
  const cap = Math.max(1, options.artistCap ?? Math.ceil(limit / 4));
  const rejected: RejectedCandidate[] = [];
  const relaxed: ValidateResult['relaxed'] = [];

  // 1 + 2 — rules and identity.
  const keys = new Set<string>();
  const clean: Song[] = [];
  for (const song of order) {
    const reason = rejectReasonFor(song, options);
    if (reason) {
      rejected.push({ song, reason, stage: 'validate' });
      continue;
    }
    const key = songKey(song);
    if (keys.has(key)) {
      rejected.push({ song, reason: 'duplicate-version', stage: 'validate' });
      continue;
    }
    keys.add(key);
    clean.push(song);
  }

  // 3 — language lock, relaxed in two steps only when the queue would starve.
  let pool = clean;
  const lock = options.lockLanguage ?? null;
  if (lock) {
    const locked = clean.filter((s) => speaks(s, lock));
    if (locked.length >= minimum || locked.length === clean.length) {
      pool = locked;
    } else {
      const familiar = new Set(options.familiarLanguages ?? []);
      const near = clean.filter((s) => speaks(s, lock) || (s.language != null && familiar.has(s.language)));
      pool = near.length >= minimum ? near : clean;
      relaxed.push('language-lock');
    }
    const keep = new Set(pool.map((s) => s.id));
    for (const s of clean) if (!keep.has(s.id)) rejected.push({ song: s, reason: 'language-lock', stage: 'validate' });
  }

  // 4 — artist cap.
  const perArtist = new Map<string, number>();
  const capped: Song[] = [];
  const overflow: Song[] = [];
  for (const song of pool) {
    const lead = leadOf(song);
    const n = lead ? perArtist.get(lead) ?? 0 : 0;
    if (lead && n >= cap) {
      overflow.push(song);
      continue;
    }
    if (lead) perArtist.set(lead, n + 1);
    capped.push(song);
  }
  if (capped.length < limit && overflow.length) {
    // Too small a pool to honour the cap: let the overflow back in, in order.
    const need = limit - capped.length;
    capped.push(...overflow.splice(0, need));
    relaxed.push('artist-cap');
  }
  for (const s of overflow) rejected.push({ song: s, reason: 'artist-cap', stage: 'validate' });

  // 5 — no lead artist back to back.
  const out: Song[] = [];
  const rest = [...capped];
  let repairs = 0;
  let prevLead = leadOf(options.seed);
  while (rest.length && out.length < limit) {
    let pick = 0;
    if (prevLead && leadOf(rest[0]) === prevLead) {
      const alt = rest.findIndex((s) => leadOf(s) !== prevLead);
      if (alt > 0) {
        pick = alt;
        repairs += 1;
      }
    }
    const [song] = rest.splice(pick, 1);
    out.push(song);
    prevLead = leadOf(song);
  }
  return { songs: out, rejected, repairs, relaxed };
}
