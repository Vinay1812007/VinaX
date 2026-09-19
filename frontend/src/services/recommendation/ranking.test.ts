// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { Song } from '@/types';
import type { Candidate, ReasonComponent } from './types';
import { buildScoringFrame, rankCandidates, scoreCandidate } from './scoring';
import { deriveIntent, type SessionEvent } from '@/services/personalization/sessionIntent';
import { makeContext, makePlay, makeSong, warmProfile } from '@/__fixtures__/songs';
import { buildUserRecommendationProfile } from './profiles';

/**
 * 7.2 — ranking audit. Every term must be able to tell two candidates apart
 * (or it is noise), unknown features must not score, inferred features must
 * count for less than supplied ones, every contribution must be on the record,
 * and the long-term profile must stay apart from this sitting's intent.
 */
const NOW = 1_800_000_000_000;
const cand = (song: Song, source: Candidate['source'] = 'trending', extra: Partial<Candidate> = {}): Candidate => ({ song, source, ...extra });
const weightOf = (reasons: ReasonComponent[], kind: ReasonComponent['kind']) => reasons.filter((r) => r.kind === kind).reduce((s, r) => s + r.weight, 0);

describe('the weekday term', () => {
  // Two candidates that differ only in language; the listener plays Hindi at weekends and Telugu on weekdays.
  const profile = (() => {
    const p = warmProfile(NOW);
    p.languages.telugu = { score: 20, plays: 40, completes: 30, skips: 2, lastTs: NOW };
    p.languages.hindi = { score: 20, plays: 40, completes: 30, skips: 2, lastTs: NOW };
    p.dayHistogram = [10, 8, 8, 8, 8, 8, 10];
    p.languageDays = { hindi: [9, 1, 1, 1, 1, 1, 9], telugu: [1, 7, 7, 7, 7, 7, 1] };
    return p;
  })();
  const te = cand(makeSong('te', { artist: 'Telugu Singer', language: 'telugu' }));
  const hi = cand(makeSong('hi', { artist: 'Hindi Singer', language: 'hindi' }));
  const scores = (dayOfWeek: number) => {
    const ctx = makeContext({ profile, dayOfWeek });
    return { te: scoreCandidate(te, ctx).score, hi: scoreCandidate(hi, ctx).score };
  };

  it('depends on the candidate, so it can change the relative order of two songs', () => {
    const saturday = scores(6);
    const wednesday = scores(3);
    expect(saturday.hi).toBeGreaterThan(saturday.te);
    expect(wednesday.te).toBeGreaterThan(wednesday.hi);
    const order = (dayOfWeek: number) => rankCandidates([te, hi], makeContext({ profile, dayOfWeek })).map((s) => s.candidate.song.id);
    expect(order(6)).toEqual(['hi', 'te']);
    expect(order(3)).toEqual(['te', 'hi']);
  });

  it('is recorded as its own reason, and is silent for a profile that predates it', () => {
    expect(scoreCandidate(hi, makeContext({ profile, dayOfWeek: 6 })).reasons.some((r) => r.kind === 'day' && r.weight > 0)).toBe(true);
    const old = { ...profile, languageDays: undefined };
    expect(scoreCandidate(hi, makeContext({ profile: old, dayOfWeek: 6 })).reasons.some((r) => r.kind === 'day')).toBe(false);
  });
});

describe('unknown and inferred features', () => {
  const seedPlain = makeSong('seed', { title: 'Seed', artist: 'S' });
  const plain = makeSong('plain', { title: 'Track Nine', artist: 'P' });
  const featureKinds = ['mood', 'energy', 'tempo', 'genre', 'vibe'] as const;

  it('contribute nothing when neither song has the feature', () => {
    const r = scoreCandidate(cand(plain), makeContext({ seedSong: seedPlain }));
    for (const kind of featureKinds) expect(weightOf(r.reasons, kind)).toBe(0);
  });

  it('count for less when inferred from a title or supplied by the classifier than when the catalogue supplies them', () => {
    const seed = makeSong('seed', { title: 'Seed', artist: 'S', mood: 'romantic', energy: 0.3, tempo: 90 });
    const ctx = makeContext({ seedSong: seed });
    const supplied = scoreCandidate(cand(makeSong('a', { title: 'Track A', artist: 'A', mood: 'romantic', energy: 0.3, tempo: 90 })), ctx);
    const classified = scoreCandidate(cand(makeSong('c', { title: 'Track C', artist: 'C', mood: 'romantic', energy: 0.3, tempo: 90 }), 'trending', { classified: ['mood', 'energy', 'tempo'] }), ctx);
    const inferred = scoreCandidate(cand(makeSong('b', { title: 'Love Song', artist: 'B' })), ctx);
    for (const kind of ['mood', 'energy'] as const) {
      expect(weightOf(supplied.reasons, kind)).toBeGreaterThan(weightOf(classified.reasons, kind));
      expect(weightOf(classified.reasons, kind)).toBeGreaterThan(weightOf(inferred.reasons, kind));
      expect(weightOf(inferred.reasons, kind)).toBeGreaterThan(0);
    }
  });

  it('do not guess the listener’s average from songs with no energy on record', () => {
    const user = buildUserRecommendationProfile(warmProfile(NOW), [], [makePlay(makeSong('h1', { title: 'Track One', artist: 'X' }), NOW)]);
    expect(user.avgEnergy).toBeNull();
    expect(user.avgTempo).toBeNull();
  });
});

describe('the record', () => {
  const ev = (minsAgo: number, type: SessionEvent['type'], artist: string, songId: string, energy = 0.5): SessionEvent => ({ t: NOW - minsAgo * 60_000, type, artist, language: 'telugu', energy, songId });
  const richCtx = () => {
    const profile = warmProfile(NOW);
    profile.artists['artist-known'] = { name: 'Known', score: 30, plays: 20, completes: 15, skips: 5, lastTs: NOW - 86_400_000 };
    profile.songs = { k1: { score: 12, plays: 6, completes: 5, skips: 0, lastTs: NOW } };
    profile.hourBuckets = { telugu: [1, 2, 8, 3] };
    profile.recentSongIds = ['k1'];
    profile.sliders = { adventurous: 0.8, recency: 0.9, energy: 0.2, vocalness: 0.3 };
    profile.energyPref = { sum: 3, n: 6 };
    profile.dayHistogram = [2, 2, 2, 2, 2, 2, 2];
    profile.languageDays = { telugu: [2, 2, 2, 4, 2, 2, 2], hindi: [1, 1, 1, 0, 1, 1, 1] };
    const history = [makePlay(makeSong('h1', { artist: 'Known' }), NOW - 3_600_000), makePlay(makeSong('h2', { artist: 'Known' }), NOW - 7_200_000), makePlay(makeSong('h3', { artist: 'Known' }), NOW - 9_000_000)];
    return makeContext({
      profile, history, hour: 14, dayOfWeek: 3, pinnedLanguages: ['telugu'], discoveryMode: 'discover',
      seedSong: makeSong('seed', { title: 'Party Seed', artist: 'Seeder', mood: 'energetic', energy: 0.8, genre: 'dance', dialect: 'coastal' }),
      sessionMood: 'energetic', sessionEnergy: 0.7, sessionLanguage: 'telugu', sessionSize: 6,
      festival: { id: 'test', languages: ['telugu'], moods: ['energetic'] },
      sessionIntent: deriveIntent([ev(9, 'complete', 'known', 'x1', 0.8), ev(7, 'complete', 'known', 'x2', 0.9), ev(5, 'skip', 'other', 'x3', 0.2), ev(3, 'skip', 'other', 'x4', 0.1), ev(1, 'like', 'known', 'x5', 0.8)], NOW),
      userProfile: buildUserRecommendationProfile(profile, [makeSong('fav', { artist: 'Known', genre: 'dance', energy: 0.7 })], history),
    });
  };
  const pool: Candidate[] = [
    cand(makeSong('k1', { title: 'Dance Anthem', artist: 'Known', genre: 'dance', energy: 0.75, dialect: 'coastal', year: String(new Date().getFullYear()) }), 'related', { sources: ['related', 'trending'], seedTitle: 'Party Seed', seedTitles: ['Party Seed'] }),
    cand(makeSong('n1', { title: 'Theme Music (Instrumental)', artist: 'Stranger', language: 'hindi', playCount: 40 }), 'explore'),
    cand(makeSong('i1', { title: 'Govinda Bhajan', artist: 'Devotee' }), 'intent', { sources: ['intent', 'related', 'favorite-artist'] }),
    cand(makeSong('m1', { title: 'Muted', artist: 'M', language: 'punjabi' }), 'trending'),
  ];

  it('records every contribution: the reasons add up to the score', () => {
    const ctx = { ...richCtx(), mutedLanguages: ['punjabi'] };
    for (const c of pool) {
      const r = scoreCandidate(c, ctx, buildScoringFrame(ctx));
      const sum = r.reasons.reduce((s, x) => s + x.weight, 0);
      expect(Math.abs(sum - r.score)).toBeLessThan(1e-9);
      expect(r.reasons.length).toBeGreaterThan(0);
    }
  });

  it('gives a small, bounded, recorded bonus when several sources agree on a song', () => {
    const ctx = richCtx();
    const agreed = scoreCandidate(pool[2], ctx);
    const alone = scoreCandidate({ ...pool[2], sources: ['intent'] }, ctx);
    const bonus = weightOf(agreed.reasons, 'agreement');
    expect(bonus).toBeGreaterThan(0);
    expect(bonus).toBeLessThanOrEqual(0.04);
    expect(agreed.score - alone.score).toBeCloseTo(bonus, 10);
    expect(alone.reasons.some((r) => r.kind === 'agreement')).toBe(false);
  });

  it('is deterministic for a fixed salt', () => {
    const a = rankCandidates(pool, richCtx()).map((s) => [s.candidate.song.id, s.score]);
    const b = rankCandidates(pool, richCtx()).map((s) => [s.candidate.song.id, s.score]);
    expect(a).toEqual(b);
  });
});

describe('long-term taste and this sitting’s intent stay apart', () => {
  const ev = (minsAgo: number, type: SessionEvent['type'], artist: string, songId: string): SessionEvent => ({ t: NOW - minsAgo * 60_000, type, artist, language: 'telugu', energy: 0.5, songId });
  const profile = (() => {
    const p = warmProfile(NOW);
    p.artists['artist-loved'] = { name: 'Loved', score: 40, plays: 30, completes: 25, skips: 0, lastTs: NOW };
    return p;
  })();
  const song = makeSong('c1', { artist: 'Loved' });
  const intent = deriveIntent([ev(5, 'skip', 'loved', 'a'), ev(3, 'skip', 'loved', 'b'), ev(1, 'skip', 'loved', 'c')], NOW);

  it('the intent moves only the intent term (and the discovery lean); every taste term is untouched', () => {
    const before = JSON.stringify(profile);
    const without = scoreCandidate(cand(song), makeContext({ profile }));
    const withIntent = scoreCandidate(cand(song), makeContext({ profile, sessionIntent: intent }));
    const tasteKinds = (rs: ReasonComponent[]) => rs.filter((r) => !['intent', 'discovery', 'familiar'].includes(r.kind)).map((r) => `${r.kind}:${r.detail ?? ''}:${r.weight.toFixed(12)}`).sort();
    expect(tasteKinds(withIntent.reasons)).toEqual(tasteKinds(without.reasons));
    expect(weightOf(withIntent.reasons, 'intent')).toBeLessThan(0);
    expect(JSON.stringify(profile)).toBe(before);
  });

  it('the long-term profile does not change what the intent term says', () => {
    const cold = scoreCandidate(cand(song), makeContext({ sessionIntent: intent }));
    const warm = scoreCandidate(cand(song), makeContext({ profile, sessionIntent: intent }));
    expect(weightOf(cold.reasons, 'intent')).toBeCloseTo(weightOf(warm.reasons, 'intent'), 12);
  });
});
