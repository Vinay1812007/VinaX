import { afterEach, describe, expect, it } from 'vitest';
import { buildScoringFrame, scoreCandidate, weightGain } from './scoring';
import { rerankCandidates } from './reranking';
import { applyWeightOverrides, DEFAULT_RECOMMENDATION_WEIGHTS, resetWeightOverrides, type RecommendationWeightKey } from './weights';
import { buildUserRecommendationProfile } from './profiles';
import type { Candidate, ReasonKind, RecommendationContext, ScoredCandidate } from './types';
import { artistWeight, bumpArtist, bumpLanguage, bumpSong, createEmptyProfile } from '../personalization/profile';
import type { HistoryEntry, Song } from '../../types';

/**
 * 9.0.0 — every key of the owner-overridable weight table moves the score it
 * is documented to move, and nothing else. Until 9.0 `artistAffinity` and
 * `session` were declared but never read, so an owner override of either
 * changed nothing; this suite is why that cannot happen again unnoticed: a
 * key added to the table without an entry here fails the coverage test.
 */

const NOW = Date.UTC(2026, 9, 4, 18, 0, 0); // a Sunday evening
const YEAR = new Date(NOW).getFullYear();

function song(id: string, over: Partial<Song> = {}): Song {
  return {
    kind: 'song', id, title: `Song ${id}`, subtitle: 'Asha Rao', artists: [{ id: 'a1', name: 'Asha Rao' }], album: null, images: [], audio: [],
    duration: 220, language: 'telugu', year: String(YEAR), explicit: false, hasLyrics: false, playCount: 2_000_000,
    mood: 'romantic', genre: 'film', genres: ['film', 'melody'], vibes: ['romantic'], dialect: 'telangana', subLanguage: 'deccani', energy: 0.6, tempo: 100,
    ...over,
  } as Song;
}

/** A context in which every documented term of the scorer is non-zero for `CANDIDATE`. */
function richContext(): RecommendationContext {
  const profile = createEmptyProfile(NOW - 90 * 86_400_000);
  bumpArtist(profile, 'a1', 'Asha Rao', 12, 'complete', NOW - 86_400_000);
  bumpArtist(profile, 'a9', 'Someone Else', 20, 'complete', NOW - 3 * 86_400_000);
  bumpLanguage(profile, 'telugu', 15, 'complete', NOW - 86_400_000);
  bumpSong(profile, 'c1', 6, 'complete', NOW - 86_400_000);
  bumpSong(profile, 'other', 9, 'complete', NOW - 86_400_000);
  profile.recentSongIds = ['c1'];
  profile.skippedSongIds = ['c1'];
  profile.likedSongIds = ['c1'];
  // Telugu is what this listener plays on Sundays, much more than on other days.
  profile.languageDays = { telugu: [12, 1, 1, 1, 1, 1, 1], hindi: [0, 6, 6, 6, 6, 6, 6] };
  const favorites = [song('fav1', { artists: [{ id: 'a1', name: 'Asha Rao' }] })];
  // Three of the last ten plays are by the candidate's lead artist (artist fatigue).
  const history: HistoryEntry[] = [0, 1, 2].map((i) => ({ song: song(`h${i}`), ts: NOW - (i + 1) * 600_000, completed: true }));
  return {
    profile,
    hour: 19,
    dayOfWeek: 0,
    region: null,
    pinnedLanguages: ['telugu'],
    mutedLanguages: [],
    intensity: 0.8,
    favorites,
    history,
    salt: 7,
    discoveryMode: 'discover',
    seedSong: song('seed', { artists: [{ id: 'a2', name: 'Ravi Kiran' }], energy: 0.55, tempo: 104 }),
    sessionMood: 'romantic',
    sessionEnergy: 0.5,
    sessionLanguage: 'telugu',
    sessionSize: 5,
    sessionIntent: {
      skipStreak: 0, completionStreak: 0, size: 3,
      artistPull: { 'asha rao': 0.5 }, languagePull: { telugu: 0.3 },
      skippedSongIds: new Set(['c1']), energySteer: 0.2, discoveryAppetite: 0,
    } as unknown as RecommendationContext['sessionIntent'],
    userProfile: buildUserRecommendationProfile(profile, favorites, history),
  };
}

const CANDIDATE: Candidate = { song: song('c1'), source: 'related', seedTitle: 'Seed' };

function byKind(scored: ScoredCandidate): Map<ReasonKind, number> {
  const out = new Map<ReasonKind, number>();
  for (const r of scored.reasons) out.set(r.kind, (out.get(r.kind) ?? 0) + r.weight);
  return out;
}

/** What each scorer key is documented to move (docs/recommendations.md, the Worker's REC_WEIGHT_TERMS). */
const SCORER_KEYS: Partial<Record<RecommendationWeightKey, ReasonKind[]>> = {
  mood: ['mood'],
  vibe: ['vibe'],
  language: ['language'],
  dialect: ['dialect'],
  genre: ['genre'],
  energy: ['energy'],
  tempo: ['tempo'],
  artistAffinity: ['artist'],
  history: ['history'],
  likes: ['likes'],
  skips: ['low-skip'],
  session: ['session', 'mood'],
  popularity: ['popularity'],
  freshness: ['fresh'],
  songAffinity: ['song'],
  dayOfWeek: ['day'],
  novelty: ['discovery', 'familiar'],
  artistFatigue: ['fatigue'],
  intentArtist: ['intent'],
  intentLanguage: ['intent'],
  intentEnergy: ['intent'],
  intentSkippedSong: ['intent'],
};
/** Keys that act in the diversity re-rank rather than in the per-song score. */
const RERANK_KEYS: RecommendationWeightKey[] = ['diversity', 'discovery'];

afterEach(() => resetWeightOverrides());

describe('owner weight overrides reach the score they are documented to move', () => {
  it('every key of the table is covered here (a new key must say what it moves)', () => {
    const covered = new Set<string>([...Object.keys(SCORER_KEYS), ...RERANK_KEYS]);
    expect([...Object.keys(DEFAULT_RECOMMENDATION_WEIGHTS)].filter((k) => !covered.has(k))).toEqual([]);
  });

  it('the fixture exercises every scorer term at the defaults', () => {
    const base = byKind(scoreCandidate(CANDIDATE, richContext()));
    for (const kinds of Object.values(SCORER_KEYS)) {
      expect(kinds!.some((k) => (base.get(k) ?? 0) !== 0), kinds!.join('/')).toBe(true);
    }
  });

  it.each(Object.entries(SCORER_KEYS))('%s: doubling it changes its own terms and leaves every other term alone', (key, kinds) => {
    const base = byKind(scoreCandidate(CANDIDATE, richContext()));
    const k = key as RecommendationWeightKey;
    expect(applyWeightOverrides({ [k]: DEFAULT_RECOMMENDATION_WEIGHTS[k] * 2 }, { version: 3, variant: null })).toEqual([k]);
    const moved = byKind(scoreCandidate(CANDIDATE, richContext()));
    const intended = new Set(kinds);
    expect(kinds!.some((kind) => Math.abs((moved.get(kind) ?? 0) - (base.get(kind) ?? 0)) > 1e-9), `${key} moved nothing`).toBe(true);
    for (const [kind, value] of base) {
      if (!intended.has(kind)) expect(moved.get(kind) ?? 0, `${key} leaked into ${kind}`).toBeCloseTo(value, 12);
    }
  });

  it('artistAffinity scales both artist terms (affinity and the last-week lift) in proportion — 9.0 fix', () => {
    const base = byKind(scoreCandidate(CANDIDATE, richContext())).get('artist')!;
    expect(base).toBeGreaterThan(0);
    applyWeightOverrides({ artistAffinity: DEFAULT_RECOMMENDATION_WEIGHTS.artistAffinity * 2 }, { version: 4, variant: null });
    expect(byKind(scoreCandidate(CANDIDATE, richContext())).get('artist')).toBeCloseTo(base * 2, 12);
    applyWeightOverrides({ artistAffinity: DEFAULT_RECOMMENDATION_WEIGHTS.artistAffinity * 0.5 }, { version: 5, variant: null });
    expect(byKind(scoreCandidate(CANDIDATE, richContext())).get('artist')).toBeCloseTo(base * 0.5, 12);
  });

  it('session scales the session vector in proportion — 9.0 fix', () => {
    const base = byKind(scoreCandidate(CANDIDATE, richContext())).get('session')!;
    expect(base).not.toBe(0);
    applyWeightOverrides({ session: DEFAULT_RECOMMENDATION_WEIGHTS.session * 2 }, { version: 6, variant: null });
    expect(byKind(scoreCandidate(CANDIDATE, richContext())).get('session')).toBeCloseTo(base * 2, 12);
  });

  it('on the defaults the 9.0 normalisation scores exactly as 8.x did', () => {
    for (const k of Object.keys(DEFAULT_RECOMMENDATION_WEIGHTS) as RecommendationWeightKey[]) expect(weightGain(k)).toBe(1);
    const ctx = richContext();
    const blend = buildScoringFrame(ctx).personalBlend;
    const raw = artistWeight(ctx.profile, ['a1'], ['Asha Rao']);
    // 8.x: add('artist', raw × 0.3 × blend) and, for an artist played in the last week, add('artist', 0.05 × blend).
    const artist = scoreCandidate(CANDIDATE, ctx).reasons.filter((r) => r.kind === 'artist').map((r) => r.weight);
    expect(artist).toEqual([raw * 0.3 * blend, 0.05 * blend].sort((a, b) => b - a));
  });
});

describe('the re-rank keys reach the re-rank', () => {
  const sc = (id: string, score: number, artist: string, source: Candidate['source'] = 'trending', language = 'telugu'): ScoredCandidate => ({
    candidate: { song: song(id, { artists: [{ id: `id-${artist}`, name: artist }], genres: [], genre: null, vibes: [], language }), source },
    score,
    reasons: [],
  });
  const ctx = { ...richContext(), explore: false };

  it('diversity: a stronger penalty lets another artist through ahead of a repeat', () => {
    const items = [sc('x', 1, 'A'), sc('y', 0.95, 'A'), sc('z', 0.78, 'B')];
    expect(rerankCandidates(items, ctx).map((i) => i.candidate.song.id)).toEqual(['x', 'y', 'z']);
    applyWeightOverrides({ diversity: DEFAULT_RECOMMENDATION_WEIGHTS.diversity * 2 }, { version: 7, variant: null });
    expect(rerankCandidates(items, ctx).map((i) => i.candidate.song.id)).toEqual(['x', 'z', 'y']);
  });

  it('discovery: a stronger floor lifts an explore pick over a slightly better familiar one', () => {
    const items = [sc('p', 0.5, 'P'), sc('e', 0.48, 'E', 'explore', 'kannada')];
    expect(rerankCandidates(items, ctx).map((i) => i.candidate.song.id)).toEqual(['p', 'e']);
    applyWeightOverrides({ discovery: DEFAULT_RECOMMENDATION_WEIGHTS.discovery * 2 }, { version: 8, variant: null });
    expect(rerankCandidates(items, ctx).map((i) => i.candidate.song.id)).toEqual(['e', 'p']);
  });
});
