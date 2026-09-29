import { canonicalKey, normalizeIdentityText, recordingKey } from '../../src/services/recommendation/identityCore';
import type { Song } from '../../src/types';

/**
 * The measuring stick.
 *
 * Deliberately NOT the pipeline's own code, except for one thing: song
 * identity, which is a published contract shared with the Worker
 * (`services/recommendation/identityCore.ts`, `shared/identity-vectors.json`).
 * Both the baseline and the current pipeline are measured with the CURRENT
 * contract, so "a remix of a song played minutes ago" means the same thing on
 * both sides of the comparison. Everything else here — the rules, the
 * repetition counts, what a discovery is — is written out again from the
 * documentation (docs/recommendations.md) rather than imported, so the
 * evaluation cannot agree with a bug by sharing its code.
 */
export const leadName = (s: Song): string => normalizeIdentityText(s.artists?.[0]?.name ?? s.subtitle?.split(',')[0] ?? '').trim();
export const creditedNames = (s: Song): string[] =>
  [...(s.artists ?? []).map((a) => a.name), ...(s.subtitle ?? '').split(',')].map((n) => normalizeIdentityText(n).trim()).filter(Boolean);
export const workKey = (s: Song): string => canonicalKey(s.title, s.artists?.[0]?.name ?? s.subtitle ?? '');
export const cutKey = (s: Song): string => recordingKey(s.title, s.artists?.[0]?.name ?? s.subtitle ?? '');

/**
 * 8.3.0 — the style a fixture's sitting is in, read the way a listener would:
 * a DJ remix says "DJ" or "Remix" in its title or album; a folk song's album
 * says "Folk" or "Janapadalu". Written out here rather than imported from
 * services/recommendation/style.ts, so the evaluation cannot agree with a bug.
 */
export type EvalStyle = 'dj' | 'folk';
export function inEvalStyle(s: Song, style: EvalStyle): boolean {
  const text = `${s.title ?? ''} ${s.album?.name ?? ''}`.toLowerCase();
  return style === 'dj' ? /\b(dj|remix)\b/.test(text) : /\bfolk\b|janapad/.test(text);
}

export type ViolationKind =
  | 'explicit-in-kid-mode'
  | 'muted-language'
  | 'hidden-artist'
  | 'hidden-song'
  | 'soft-muted-artist'
  | 'recently-played'
  | 'duplicate-identity'
  | 'off-language'
  // 8.1.0 — the mix policy's own rules (only counted when a fixture asks for 'mix').
  | 'language-opening'
  | 'language-run';

export const VIOLATION_KINDS: ViolationKind[] = [
  'explicit-in-kid-mode',
  'muted-language',
  'hidden-artist',
  'hidden-song',
  'soft-muted-artist',
  'recently-played',
  'duplicate-identity',
  'off-language',
  'language-opening',
  'language-run',
];

export interface RuleContext {
  kidMode: boolean;
  mutedLanguages: Set<string>;
  /** Normalised display names on the never-play list. */
  hiddenArtists: Set<string>;
  hiddenSongIds: Set<string>;
  /** Normalised names under an active soft mute. */
  softMuted: Set<string>;
  /** Ids and identities the listener heard recently (profile + history). */
  recentIds: Set<string>;
  recentKeys: Set<string>;
  /** Already in the queue when this continuation was asked for (the seed included). */
  queuedIds: Set<string>;
  queuedKeys: Set<string>;
  /** The language the stretch is locked to (the seed's), or null. */
  lock: string | null;
  /**
   * 8.1.0 — the mix policy: songs in `allowed` (the listener's languages) may
   * ship; `lead` (the seed's language) must open the stretch and an off-lead
   * song is never followed by another. A language outside `allowed` is still
   * off-language.
   */
  mix?: { lead: string | null; allowed: Set<string> } | null;
}

export type Violations = Record<ViolationKind, number>;

export const noViolations = (): Violations => Object.fromEntries(VIOLATION_KINDS.map((k) => [k, 0])) as Violations;

/** Does this song break a rule that is never allowed to bend? */
export function breaksRule(song: Song, rc: RuleContext): ViolationKind | null {
  if (rc.kidMode && song.explicit) return 'explicit-in-kid-mode';
  if (song.language && rc.mutedLanguages.has(song.language)) return 'muted-language';
  if (rc.hiddenSongIds.has(song.id)) return 'hidden-song';
  if (creditedNames(song).some((n) => rc.hiddenArtists.has(n))) return 'hidden-artist';
  if (rc.softMuted.has(leadName(song))) return 'soft-muted-artist';
  if (rc.recentIds.has(song.id) || rc.recentKeys.has(workKey(song))) return 'recently-played';
  if (rc.queuedIds.has(song.id) || rc.queuedKeys.has(workKey(song))) return 'duplicate-identity';
  return null;
}

/** Count the rule breaks in one continuation. Off-language is counted apart: the lock may bend when the queue would starve. */
export function violationsOf(songs: Song[], rc: RuleContext): Violations {
  const counts = noViolations();
  const seen = new Set<string>();
  for (const song of songs) {
    const kind = breaksRule(song, rc);
    if (kind) counts[kind] += 1;
    const key = workKey(song);
    if (seen.has(key)) counts['duplicate-identity'] += 1;
    seen.add(key);
    if (rc.lock && song.language && song.language !== 'unknown' && song.language !== rc.lock) counts['off-language'] += 1;
    if (rc.mix && song.language && song.language !== 'unknown' && !rc.mix.allowed.has(song.language)) counts['off-language'] += 1;
  }
  if (rc.mix?.lead) {
    const lead = rc.mix.lead;
    const off = (s: Song): boolean => !!s.language && s.language !== 'unknown' && s.language !== lead;
    songs.slice(0, Math.min(2, songs.length)).forEach((s) => { if (off(s)) counts['language-opening'] += 1; });
    for (let i = 1; i < songs.length; i += 1) if (off(songs[i]) && off(songs[i - 1])) counts['language-run'] += 1;
  }
  return counts;
}

/** Songs from the fixture's catalogue that this continuation could have used. */
export function eligible(poolSongs: Song[], rc: RuleContext): Song[] {
  return poolSongs.filter((s) => !breaksRule(s, rc) && (!rc.lock || !s.language || s.language === 'unknown' || s.language === rc.lock) && (!rc.mix || !s.language || s.language === 'unknown' || rc.mix.allowed.has(s.language)));
}

export function addViolations(into: Violations, from: Violations): Violations {
  for (const k of VIOLATION_KINDS) into[k] += from[k];
  return into;
}

export const totalViolations = (v: Violations, except: ViolationKind[] = []): number =>
  VIOLATION_KINDS.filter((k) => !except.includes(k)).reduce((n, k) => n + v[k], 0);
