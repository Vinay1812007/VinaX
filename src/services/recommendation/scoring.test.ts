import { describe, it, expect } from 'vitest';
import { scoreCandidate, rankCandidates } from './scoring';
import type { Candidate, RecommendationContext } from './types';
import { createEmptyProfile } from '../personalization/profile';
import type { Song } from '../../types';

function song(over: Partial<Song> = {}): Song {
  return {
    kind: 'song',
    id: 'id1',
    title: 'Title',
    subtitle: 'Artist',
    artists: [{ id: 'a1', name: 'Artist' }],
    album: null,
    images: [],
    audio: [],
    duration: 200,
    language: 'telugu',
    year: null,
    explicit: false,
    hasLyrics: false,
    playCount: null,
    ...over,
  };
}

function ctx(over: Partial<RecommendationContext> = {}): RecommendationContext {
  return {
    profile: createEmptyProfile(0),
    hour: 12,
    region: null,
    pinnedLanguages: [],
    mutedLanguages: [],
    intensity: 0.6,
    favorites: [],
    history: [],
    salt: 1,
    ...over,
  };
}

const cand = (s: Song, source: Candidate['source'] = 'trending'): Candidate => ({ song: s, source });

describe('scoreCandidate', () => {
  it('excludes muted languages with a negative score', () => {
    const r = scoreCandidate(cand(song({ language: 'hindi' })), ctx({ mutedLanguages: ['hindi'] }));
    expect(r.score).toBe(-1);
  });

  it('rewards higher popularity for a cold profile', () => {
    const low = scoreCandidate(cand(song({ id: 'a', playCount: 10 })), ctx());
    const high = scoreCandidate(cand(song({ id: 'b', playCount: 5_000_000 })), ctx());
    expect(high.score).toBeGreaterThan(low.score);
  });

  it('penalizes very recently played songs', () => {
    const base = scoreCandidate(cand(song({ id: 'x' })), ctx());
    const profile = { ...createEmptyProfile(0), recentSongIds: ['x'] };
    const recent = scoreCandidate(cand(song({ id: 'x' })), ctx({ profile }));
    expect(recent.score).toBeLessThan(base.score);
  });

  it('attaches explainable reason components', () => {
    const r = scoreCandidate(cand(song({ playCount: 1000 })), ctx());
    expect(r.reasons.some((x) => x.kind === 'popularity')).toBe(true);
  });
});

describe('rankCandidates', () => {
  it('dedupes by song id and drops non-positive (muted) scores', () => {
    const out = rankCandidates(
      [
        cand(song({ id: 's1', language: 'telugu', playCount: 1000 })),
        cand(song({ id: 's1', language: 'telugu', playCount: 1000 })),
        cand(song({ id: 's2', language: 'hindi' })),
      ],
      ctx({ mutedLanguages: ['hindi'] }),
    );
    expect(out.map((x) => x.candidate.song.id)).toEqual(['s1']);
  });

  it('returns results sorted by score (highest first)', () => {
    const out = rankCandidates(
      [cand(song({ id: 'a', playCount: 5 })), cand(song({ id: 'b', playCount: 9_000_000 }))],
      ctx(),
    );
    expect(out.length).toBe(2);
    expect(out[0].score).toBeGreaterThanOrEqual(out[1].score);
  });
});
