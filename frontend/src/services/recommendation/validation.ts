import type { Song } from '@/types';
import { songKey } from './songIdentity';
import { rejectReasonFor, type HardFilterOptions } from './filters';
import type { RejectedCandidate, Relaxation, RelaxedRule } from './types';

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
 *      soft-muted artist, already queued / recently played / skipped this
 *      sitting) — these are never relaxed;
 *   2. one song per canonical identity;
 *   3. under a language lock, off-language songs are dropped — unless that
 *      would leave the queue with almost nothing, in which case languages
 *      the listener actually plays are let back in before anything else;
 *   4. slot by slot, in the given order (a later song is pulled forward only
 *      to satisfy a rule), the sequencer's final policy:
 *        a. one lead artist fills at most `artistCap` of the slots;
 *        b. 7.2.0 — at most ⌊discoveryShare × limit + 0.5⌋ discoveries;
 *        c. 7.2.0 — the familiar opening: no discovery in slot 1, nor in
 *           slot 2 of a stretch of four or more;
 *        d. no lead artist twice in a row (the seed counts as the previous
 *           song).
 *      When no remaining song satisfies all of them, they give way in the
 *      order d, a, b, c — each only for that slot, and a, b and c are
 *      reported in `relaxed` (d never was: it is counted in `repairs`).
 *
 * Order is otherwise preserved, so an accepted arc stays an arc. The local
 * order, the AI order and the reserve top-up all pass through here.
 */
export interface ValidateOptions extends HardFilterOptions {
  limit: number;
  /** The queue's language under a 'lock' policy; null = no lock. */
  lockLanguage?: string | null;
  /** Languages the listener plays: the first fallback when a locked queue runs short. */
  familiarLanguages?: string[];
  /** Fewest songs worth shipping before the language lock is relaxed. */
  minimum?: number;
  /** Max songs per lead artist; default ⌈limit / 4⌉ (two in a queue of eight). */
  artistCap?: number;
  /**
   * 7.2.0 — the song this stretch will FOLLOW in the queue, when that is not
   * the seed: a continuation is appended after the last queued song, so the
   * no-repeat-artist rule has to look at that pair, not at what is playing.
   */
  previous?: Song | null;
  /** 7.2.0 — the songs the sequencer counts as discoveries (never-played artists, explore picks). */
  discoveryIds?: Set<string>;
  /** 7.2.0 — 0..1 share of the stretch open to discoveries; the cap is ⌊share × limit + 0.5⌋. Absent = no cap. */
  discoveryShare?: number;
  /** 7.2.0 — hold discoveries out of the opening (slot 1; slot 2 too when four or more ship). Default true when `discoveryIds` is given. */
  familiarOpening?: boolean;
}

export interface ValidateResult {
  songs: Song[];
  rejected: RejectedCandidate[];
  /** Songs moved to break a same-artist pair. */
  repairs: number;
  /** Rules that had to be relaxed to fill the queue (each once, first relaxed first). */
  relaxed: RelaxedRule[];
  /** 7.2.0 — the same, with what gave: the slot, the song and why. */
  relaxations: Relaxation[];
  /** 7.2.0 — the language-lock step used: null (held), 'familiar' (languages the listener plays let in), 'any' (every language). */
  languageLockStep: 'familiar' | 'any' | null;
}

const leadOf = (s: Song | null | undefined): string => (s?.artists?.[0]?.name ?? s?.subtitle?.split(',')[0] ?? '').trim().toLowerCase();
const speaks = (s: Song, language: string): boolean => !s.language || s.language === 'unknown' || s.language === language;

export function validateSequence(order: Song[], options: ValidateOptions): ValidateResult {
  const limit = Math.max(0, Math.floor(options.limit));
  const minimum = Math.min(limit, options.minimum ?? 3);
  const cap = Math.max(1, options.artistCap ?? Math.ceil(limit / 4));
  const rejected: RejectedCandidate[] = [];
  const relaxed: RelaxedRule[] = [];
  const relaxations: Relaxation[] = [];
  const relax = (r: Relaxation): void => {
    if (!relaxed.includes(r.rule)) relaxed.push(r.rule);
    relaxations.push(r);
  };

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
  let languageLockStep: ValidateResult['languageLockStep'] = null;
  const lock = options.lockLanguage ?? null;
  if (lock) {
    const locked = clean.filter((s) => speaks(s, lock));
    if (locked.length >= minimum || locked.length === clean.length) {
      pool = locked;
    } else {
      const familiar = new Set(options.familiarLanguages ?? []);
      const near = clean.filter((s) => speaks(s, lock) || (s.language != null && familiar.has(s.language)));
      languageLockStep = near.length >= minimum ? 'familiar' : 'any';
      pool = languageLockStep === 'familiar' ? near : clean;
      relax({ rule: 'language-lock', detail: `${languageLockStep === 'familiar' ? 'familiar languages let in' : 'every language let in'}: ${locked.length} of ${minimum} in ${lock}` });
    }
    const keep = new Set(pool.map((s) => s.id));
    for (const s of clean) if (!keep.has(s.id)) rejected.push({ song: s, reason: 'language-lock', stage: 'validate' });
  }

  // 4 — the stretch, slot by slot.
  const discovery = options.discoveryIds;
  const isDiscovery = (s: Song): boolean => !!discovery?.has(s.id);
  const discoveryCap = discovery && typeof options.discoveryShare === 'number' ? Math.floor(Math.max(0, Math.min(1, options.discoveryShare)) * limit + 0.5) : Infinity;
  const n = Math.min(limit, pool.length);
  const openingSlots = discovery && options.familiarOpening !== false ? (n >= 4 ? 2 : 1) : 0;
  const perArtist = new Map<string, number>();
  const out: Song[] = [];
  const rest = [...pool];
  let discoveries = 0;
  let repairs = 0;
  let prevLead = leadOf(options.previous ?? options.seed);
  const capOk = (s: Song): boolean => !leadOf(s) || (perArtist.get(leadOf(s)) ?? 0) < cap;
  const shareOk = (s: Song): boolean => !isDiscovery(s) || discoveries < discoveryCap;
  const openOk = (s: Song): boolean => !isDiscovery(s) || out.length >= openingSlots;
  const apartOk = (s: Song): boolean => !prevLead || leadOf(s) !== prevLead;
  const policy = (s: Song): boolean => capOk(s) && shareOk(s) && openOk(s);
  // Most rules first; each later tier gives one more rule way, in the order d, a, b, c.
  const tiers: Array<(s: Song) => boolean> = [(s) => policy(s) && apartOk(s), policy, (s) => shareOk(s) && openOk(s), openOk, () => true];
  while (rest.length && out.length < limit) {
    let pick = -1;
    for (let t = 0; pick < 0; t += 1) pick = rest.findIndex(tiers[t]);
    // A later song pulled forward past one that would repeat the previous lead artist.
    const natural = rest.findIndex(policy);
    if (natural >= 0 && natural < pick && apartOk(rest[pick])) repairs += 1;
    const [song] = rest.splice(pick, 1);
    const at = { slot: out.length + 1, songId: song.id };
    if (!capOk(song)) relax({ rule: 'artist-cap', ...at, detail: `song ${(perArtist.get(leadOf(song)) ?? 0) + 1} by one artist over a cap of ${cap}; nothing else could fill the slot` });
    if (!shareOk(song)) relax({ rule: 'discovery-share', ...at, detail: `discovery ${discoveries + 1} over a cap of ${discoveryCap}; nothing else could fill the slot` });
    if (!openOk(song)) relax({ rule: 'familiar-opening', ...at, detail: 'a discovery in the opening; no familiar song was left' });
    if (leadOf(song)) perArtist.set(leadOf(song), (perArtist.get(leadOf(song)) ?? 0) + 1);
    if (isDiscovery(song)) discoveries += 1;
    out.push(song);
    prevLead = leadOf(song);
  }
  // What the policy left out, with the rule that did it (the rest simply did not fit).
  for (const s of rest) {
    if (!capOk(s)) rejected.push({ song: s, reason: 'artist-cap', stage: 'validate' });
    else if (!shareOk(s)) rejected.push({ song: s, reason: 'discovery-share', stage: 'validate' });
  }
  return { songs: out, rejected, repairs, relaxed, relaxations, languageLockStep };
}
