import { describe, it, expect } from 'vitest';
import { scoreCandidate, rankCandidates } from './scoring';
import type { Candidate, RecommendationContext } from './types';
import { createEmptyProfile, type TasteSliders } from '../personalization/profile';
import { sliderDialLines, DEFAULT_SLIDERS } from '../personalization/dials';
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

  it('session vector (A1): rewards a candidate matching the session energy', () => {
    // Session is a high-energy run; an energetic candidate should out-score a
    // melancholy one purely from the session term (profiles are identical).
    const sessionCtx = ctx({ sessionEnergy: 0.9, sessionSize: 6, sessionLanguage: 'telugu' });
    const energetic = scoreCandidate(cand(song({ id: 'e', title: 'Party Dance Blast' })), sessionCtx);
    const sad = scoreCandidate(cand(song({ id: 's', title: 'Sad lonely tears' })), sessionCtx);
    expect(energetic.score).toBeGreaterThan(sad.score);
    expect(energetic.reasons.some((x) => x.kind === 'session')).toBe(true);
  });

  it('session vector (A1): no effect until at least 2 songs have played', () => {
    // sessionEnergy omitted (cold vector) → no session reason attached.
    const r = scoreCandidate(cand(song({ title: 'Party Dance' })), ctx());
    expect(r.reasons.some((x) => x.kind === 'session')).toBe(false);
  });
});

describe('taste dials (C3)', () => {
  const withSliders = (over: Partial<TasteSliders>): RecommendationContext =>
    ctx({ profile: { ...createEmptyProfile(0), sliders: { ...DEFAULT_SLIDERS, ...over } } });

  it('is a no-op when the profile has no sliders (identical to before C3)', () => {
    const plain = scoreCandidate(cand(song({ playCount: 1000 })), ctx());
    const neutral = scoreCandidate(cand(song({ playCount: 1000 })), withSliders({}));
    expect(neutral.score).toBeCloseTo(plain.score, 10);
  });

  it('adventurous lifts a discovery pick; familiar demotes it', () => {
    const adventurous = scoreCandidate(cand(song({ playCount: 1000 }), 'trending'), withSliders({ adventurous: 1 }));
    const familiar = scoreCandidate(cand(song({ playCount: 1000 }), 'trending'), withSliders({ adventurous: 0 }));
    expect(adventurous.score).toBeGreaterThan(familiar.score);
  });

  it('the energy dial rewards the matching end of the energy axis', () => {
    const party = song({ id: 'p', title: 'Party Dance Blast', playCount: 1000 });
    const beats = scoreCandidate(cand(party), withSliders({ energy: 1 }));
    const mellow = scoreCandidate(cand(party), withSliders({ energy: 0 }));
    expect(beats.score).toBeGreaterThan(mellow.score);
  });

  it('the recency dial favors new releases when high, classics when low', () => {
    const brandNew = song({ id: 'n', year: String(new Date().getFullYear()), playCount: 1000 });
    const recent = scoreCandidate(cand(brandNew), withSliders({ recency: 1 }));
    const classic = scoreCandidate(cand(brandNew), withSliders({ recency: 0 }));
    expect(recent.score).toBeGreaterThan(classic.score);
  });

  it('the vocal dial nudges title-detectable instrumentals', () => {
    const instrumental = song({ id: 'i', title: 'Theme Music (Instrumental)', playCount: 1000 });
    const wantsInstrumental = scoreCandidate(cand(instrumental), withSliders({ vocalness: 0 }));
    const wantsVocal = scoreCandidate(cand(instrumental), withSliders({ vocalness: 1 }));
    expect(wantsInstrumental.score).toBeGreaterThan(wantsVocal.score);
  });
});

describe('exploration budget (A4)', () => {
  it('an explore candidate scores positive with a discovery reason, below taste picks', () => {
    const c = ctx();
    const exploreCand = scoreCandidate(cand(song({ id: 'e', language: 'bhojpuri', playCount: 500_000 }), 'explore'), c);
    expect(exploreCand.score).toBeGreaterThan(0);
    expect(exploreCand.reasons.some((r) => r.kind === 'discovery')).toBe(true);
    const related = scoreCandidate(cand(song({ id: 'r', playCount: 500_000 }), 'related'), c);
    expect(related.score).toBeGreaterThan(exploreCand.score);
  });
});

describe('festival boost (A10)', () => {
  it('lifts a song in the festival language during its window', () => {
    const s = song({ id: 'm', language: 'malayalam', playCount: 1000 });
    const withFest = scoreCandidate(cand(s), ctx({ festival: { id: 'onam', languages: ['malayalam'] } }));
    const noFest = scoreCandidate(cand(s), ctx());
    expect(withFest.score).toBeGreaterThan(noFest.score);
  });

  it('lifts a devotional-mood song for a devotional festival', () => {
    const s = song({ id: 'b', title: 'Krishna Bhajan', language: 'hindi', playCount: 1000 });
    const withFest = scoreCandidate(cand(s), ctx({ festival: { id: 'diwali', moods: ['devotional'] } }));
    const noFest = scoreCandidate(cand(s), ctx());
    expect(withFest.score).toBeGreaterThan(noFest.score);
  });

  it('is a no-op off-season (festival null)', () => {
    const s = song({ id: 'x', language: 'telugu', playCount: 1000 });
    const off = scoreCandidate(cand(s), ctx({ festival: null }));
    const plain = scoreCandidate(cand(s), ctx());
    expect(off.score).toBeCloseTo(plain.score, 10);
  });
});

describe('sliderDialLines (C3)', () => {
  it('emits nothing while every dial sits near neutral', () => {
    expect(sliderDialLines(DEFAULT_SLIDERS)).toEqual([]);
  });

  it('summarizes only the dials moved off centre', () => {
    const lines = sliderDialLines({ ...DEFAULT_SLIDERS, adventurous: 0.9, energy: 0.1 });
    expect(lines).toHaveLength(2);
    expect(lines.some((l) => /adventurous/i.test(l))).toBe(true);
    expect(lines.some((l) => /mellow|melody/i.test(l))).toBe(true);
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
