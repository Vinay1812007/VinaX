import { describe, it, expect } from 'vitest';
import { scoreCandidate, rankCandidates, styleTerm } from './scoring';
import { STYLE_WEIGHTS } from './weights';
import { songKey as songKeyOf } from './songIdentity';
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

describe('8.2.0 — taste fit and served memory', () => {
  const loved = song({ id: 'loved', artists: [{ id: 'sid', name: 'Sid Sriram' }], album: { id: 'alb', name: 'Film' }, genre: 'film' });
  const kin = song({ id: 'kin', artists: [{ id: 'sid', name: 'Sid Sriram' }], album: { id: 'alb', name: 'Film' }, genre: 'film' });
  const stranger = song({ id: 'str', artists: [{ id: 'zz', name: 'Stranger' }], album: { id: 'other', name: 'Other' }, genre: 'rock', year: '1990' });
  const taste = (c: ReturnType<typeof scoreCandidate>) => c.reasons.filter((r) => r.kind === 'taste').reduce((s, r) => s + r.weight, 0);

  it('adds a bounded taste term that favours what resembles favourites, and nothing without taste', () => {
    const c = ctx({ favorites: [loved] });
    const near = taste(scoreCandidate(cand(kin), c));
    const far = taste(scoreCandidate(cand(stranger), c));
    expect(near).toBeGreaterThan(far);
    expect(near).toBeLessThanOrEqual(0.15);
    expect(taste(scoreCandidate(cand(kin), ctx()))).toBe(0);
  });

  it('holds back songs other surfaces showed and the last opening after this seed, as penalties with a reason', () => {
    const base = scoreCandidate(cand(kin), ctx()).score;
    const shown = scoreCandidate(cand(kin), ctx({ servedKeys: new Set(['sentinel']) }));
    expect(shown.score).toBe(base); // not served: unchanged
    const served = scoreCandidate(cand(kin), ctx({ servedKeys: new Set([songKeyOf(kin)]) }));
    expect(served.score).toBeCloseTo(base - 0.04, 6);
    expect(served.reasons.some((r) => r.kind === 'served' && r.weight < 0)).toBe(true);
    const repeat = scoreCandidate(cand(kin), ctx({ seedRepeatIds: new Set(['kin']) }));
    expect(repeat.score).toBeCloseTo(base - 0.1, 6);
  });

  it('uses a learned embedding only relative to the pool, and never for a candidate without one', () => {
    const x = Float32Array.from([1, 0]);
    const y = Float32Array.from([0, 1]);
    const favorites = ['f1', 'f2', 'f3'].map((id) => song({ id, artists: [{ id: 'sid', name: 'Sid Sriram' }] }));
    const vectors: Record<string, Float32Array> = { f1: x, f2: x, f3: x, a: x, b: y, c: y };
    const pool = ['a', 'b', 'c', 'd'].map((id) => cand(song({ id, artists: [{ id: `ar-${id}`, name: `Artist ${id}` }] })));
    const withVectors = rankCandidates(pool, ctx({ favorites, embeddingOf: (id) => vectors[id] ?? null }));
    const without = rankCandidates(pool, ctx({ favorites }));
    const fit = (list: typeof withVectors, id: string) => taste(list.find((s) => s.candidate.song.id === id)!);
    expect(fit(withVectors, 'a')).toBeGreaterThan(fit(without, 'a'));
    expect(fit(withVectors, 'b')).toBeLessThanOrEqual(fit(without, 'b'));
    expect(fit(withVectors, 'd')).toBeCloseTo(fit(without, 'd'), 9); // no vector: the on-device fit alone
  });
});

describe('8.2.0 — an artist skipped in this sitting sinks (verified, unchanged)', () => {
  it('pulls the score down through the session intent', () => {
    const s = song({ id: 'x', artists: [{ id: 'a1', name: 'Anirudh' }] });
    const intent = (pull: number) => ({ skipStreak: 1, completionStreak: 0, artistPull: { anirudh: pull }, languagePull: {}, skippedSongIds: new Set<string>(), energySteer: 0, discoveryAppetite: 0, size: 3 });
    const skipped = scoreCandidate(cand(s), ctx({ sessionIntent: intent(-1) }));
    const neutral = scoreCandidate(cand(s), ctx({ sessionIntent: intent(0) }));
    expect(skipped.score).toBeLessThan(neutral.score);
    expect(skipped.reasons.find((r) => r.kind === 'intent')?.weight).toBeLessThan(0);
  });
});

describe('8.3.0 — the style term', () => {
  const remix = song({ id: 'r', title: 'Mama Nagulo (DJ Remix Song)' });
  const plain = song({ id: 'p', title: 'Film Song', playCount: 90_000_000 });
  const tagged = song({ id: 't', title: 'Village Song', genre: 'folk' });

  it('lifts a song in the style, less for metadata alone, and costs a song outside it', () => {
    expect(styleTerm(remix, 'dj')).toEqual(['dj', STYLE_WEIGHTS.match]);
    expect(styleTerm(tagged, 'folk')).toEqual(['folk', STYLE_WEIGHTS.metaMatch]);
    expect(styleTerm(plain, 'dj')).toEqual(['off-dj', STYLE_WEIGHTS.offStyle]);
  });

  it('is on the record as a reason, and absent without a style', () => {
    const on = scoreCandidate(cand(remix), ctx({ style: 'dj' }));
    const off = scoreCandidate(cand(remix), ctx());
    expect(on.reasons).toContainEqual({ kind: 'style', weight: STYLE_WEIGHTS.match, detail: 'dj' });
    expect(on.score - off.score).toBeCloseTo(STYLE_WEIGHTS.match, 6);
    expect(off.reasons.some((r) => r.kind === 'style')).toBe(false);
    // A very popular film song ranks below a remix in a DJ session, above it without one.
    const ranked = (style: 'dj' | null) => rankCandidates([cand(plain), cand(remix)], ctx({ style })).map((x) => x.candidate.song.id);
    expect(ranked('dj')[0]).toBe('r');
    expect(ranked(null)[0]).toBe('p');
  });
});
