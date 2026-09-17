// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildScoringFrame, rankCandidates, scoreCandidate } from './scoring';
import type { Candidate } from './types';
import { deriveIntent, type SessionEvent } from '@/services/personalization/sessionIntent';
import { makeContext, makePlay, makeSong, warmProfile } from '@/__fixtures__/songs';

/**
 * v7.0.0 — Familiar / Balanced / Discover must actually change ranking. Three
 * candidates that differ only in how well the listener knows them: a song
 * already played, an unheard song by a known artist, and a never-played artist.
 */
const NOW = 1_800_000_000_000;
const known = makeSong('known-song', { artist: 'Known Artist' });
const knownArtistNew = makeSong('new-song', { artist: 'Known Artist' });
const stranger = makeSong('stranger', { artist: 'Never Heard' });
const history = [makePlay(known, NOW - 40 * 86_400_000), makePlay(makeSong('other', { artist: 'Known Artist' }), NOW - 41 * 86_400_000)];
const profile = (() => {
  const p = warmProfile(NOW);
  p.artists['artist-known-artist'] = { name: 'Known Artist', score: 0, plays: 4, completes: 3, skips: 0, lastTs: NOW - 40 * 86_400_000 };
  return p;
})();
const cands: Candidate[] = [known, knownArtistNew, stranger].map((song) => ({ song, source: 'trending' as const }));
const scoreIn = (mode: 'familiar' | 'balanced' | 'discover') => {
  const ctx = makeContext({ profile, history, discoveryMode: mode });
  const frame = buildScoringFrame(ctx);
  return Object.fromEntries(cands.map((c) => [c.song.id, scoreCandidate(c, ctx, frame).score]));
};

describe('discovery modes', () => {
  it('Balanced is neutral: the mode adds nothing to any candidate', () => {
    const balanced = scoreIn('balanced');
    const noMode = Object.fromEntries(cands.map((c) => [c.song.id, scoreCandidate(c, makeContext({ profile, history })).score]));
    expect(balanced).toEqual(noMode);
  });

  it('Familiar lifts what is known and sinks strangers; Discover does the reverse, symmetrically', () => {
    const familiar = scoreIn('familiar');
    const balanced = scoreIn('balanced');
    const discover = scoreIn('discover');
    expect(familiar['known-song'] - balanced['known-song']).toBeCloseTo(0.08);
    expect(familiar.stranger - balanced.stranger).toBeCloseTo(-0.08);
    expect(discover.stranger - balanced.stranger).toBeCloseTo(0.08);
    expect(discover['known-song'] - balanced['known-song']).toBeCloseTo(-0.08);
    // An unheard song by a known artist is the midpoint in every mode.
    expect(familiar['new-song']).toBeCloseTo(balanced['new-song']);
    expect(discover['new-song']).toBeCloseTo(balanced['new-song']);
  });

  it('changes the ORDER, not just the numbers', () => {
    const order = (mode: 'familiar' | 'discover') => rankCandidates(cands, makeContext({ profile, history, discoveryMode: mode })).map((s) => s.candidate.song.id);
    const familiar = order('familiar');
    const discover = order('discover');
    expect(familiar.indexOf('known-song')).toBeLessThan(familiar.indexOf('stranger'));
    expect(discover.indexOf('stranger')).toBeLessThan(discover.indexOf('known-song'));
  });

  it('explains itself', () => {
    const ctxD = makeContext({ profile, history, discoveryMode: 'discover' });
    expect(scoreCandidate(cands[2], ctxD).reasons).toContainEqual({ kind: 'discovery', weight: expect.closeTo(0.08), detail: 'new-artist' });
    const ctxF = makeContext({ profile, history, discoveryMode: 'familiar' });
    expect(scoreCandidate(cands[0], ctxF).reasons.some((r) => r.kind === 'familiar')).toBe(true);
  });

  it('keeps legacy explore=true meaning Discover', () => {
    expect(buildScoringFrame(makeContext({ explore: true })).lean).toBe(1);
    expect(buildScoringFrame(makeContext({})).lean).toBe(0);
  });
});

describe('session adaptation in scoring', () => {
  const ev = (minsAgo: number, type: SessionEvent['type'], artist: string, songId: string, energy = 0.5): SessionEvent => ({ t: NOW - minsAgo * 60_000, type, artist, language: 'telugu', energy, songId });

  it('a skip streak tips Balanced toward the familiar without touching the long-term profile', () => {
    const sessionIntent = deriveIntent([ev(6, 'skip', 'x', 's1'), ev(4, 'skip', 'y', 's2'), ev(2, 'skip', 'z', 's3')], NOW);
    const before = JSON.stringify(profile);
    const ctx = makeContext({ profile, history, discoveryMode: 'balanced', sessionIntent });
    expect(buildScoringFrame(ctx).lean).toBeLessThan(0);
    expect(scoreCandidate(cands[0], ctx).score).toBeGreaterThan(scoreCandidate(cands[2], ctx).score);
    expect(JSON.stringify(profile)).toBe(before);
  });

  it('sinks an artist being skipped right now, lifts one just searched for, and drops a song skipped minutes ago', () => {
    const base = makeContext({ profile, history });
    const skipping = makeContext({ profile, history, sessionIntent: deriveIntent([ev(5, 'skip', 'never heard', 'a'), ev(3, 'skip', 'never heard', 'b'), ev(1, 'complete', 'known artist', 'c')], NOW) });
    expect(scoreCandidate(cands[2], skipping).score).toBeLessThan(scoreCandidate(cands[2], base).score - 0.1);
    expect(scoreCandidate(cands[2], skipping).reasons.some((r) => r.kind === 'intent' && r.weight < 0)).toBe(true);
    const searched = makeContext({ profile, history, sessionIntent: deriveIntent([ev(3, 'search_play', 'never heard', 'a'), ev(2, 'queue_add', 'never heard', 'b'), ev(1, 'like', 'never heard', 'c')], NOW) });
    expect(scoreCandidate(cands[2], searched).score).toBeGreaterThan(scoreCandidate(cands[2], base).score + 0.1);
    const skippedIt = makeContext({ profile, history, sessionIntent: deriveIntent([ev(5, 'skip', 'q', 'stranger'), ev(3, 'complete', 'w', 'x'), ev(1, 'complete', 'w', 'y')], NOW) });
    expect(scoreCandidate(cands[2], skippedIt).score).toBeLessThan(scoreCandidate(cands[2], base).score - 0.35);
  });

  it('charges artist fatigue from the third recent play on, capped', () => {
    const artist = 'Everywhere';
    const recent = (n: number) => Array.from({ length: n }, (_, i) => makePlay(makeSong(`r${i}`, { artist }), NOW - i * 240_000));
    const cand: Candidate = { song: makeSong('next', { artist }), source: 'trending' };
    const fatigueOf = (n: number) => scoreCandidate(cand, makeContext({ profile, history: recent(n) })).reasons.find((r) => r.kind === 'fatigue')?.weight ?? 0;
    expect(fatigueOf(2)).toBe(0);
    expect(fatigueOf(3)).toBeCloseTo(-0.04);
    expect(fatigueOf(5)).toBeCloseTo(-0.12);
    expect(fatigueOf(10)).toBeCloseTo(-0.16);
  });
});
