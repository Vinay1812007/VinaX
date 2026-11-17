/**
 * Your Week — the weekly discovery mix. Only songs the listener has never
 * heard (history, taste profile and the lifetime heard-set), first by lead
 * artists they have never played, then topped up from the explore source.
 * Made for you's "New to you this week" is the same pick, 30 songs long.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Song } from '@/types';
import { makeContext as makeCtx, makePlay, makeSong } from '@/__fixtures__/songs';
import { buildMixes, WEEK_SIZE, weekDiscoveries } from './mixes';
import { registerHeardCheck } from './admission';
import { songKey } from './songIdentity';
import type { CandidateSource, ScoredCandidate } from './types';

const cand = (song: Song, source: CandidateSource = 'related'): ScoredCandidate => ({ candidate: { song, source }, score: 1, reasons: [] });
const ids = (list: Song[]) => list.map((s) => s.id);

afterEach(() => registerHeardCheck(undefined));

describe('weekDiscoveries', () => {
  it('leaves out songs in the history and artists the listener already plays', () => {
    const known = makeSong('h1', { artist: 'Known Singer' });
    const ctx = makeCtx({ history: [makePlay(known, Date.now())] });
    const ranked = [
      cand(known),
      cand(makeSong('k2', { artist: 'Known Singer' })),
      cand(makeSong('n1', { artist: 'New One' })),
      cand(makeSong('n2', { artist: 'New Two' })),
    ];
    expect(ids(weekDiscoveries(ranked, ctx, 30, undefined))).toEqual(['n1', 'n2']);
  });

  it('leaves out songs in the lifetime heard-set, even from the explore source', () => {
    const heard = makeSong('old', { artist: 'Someone', title: 'Heard Long Ago' });
    const ranked = [cand(heard), cand(makeSong('x1', { artist: 'Explorer' }), 'explore'), cand(makeSong('new', { artist: 'Other' }))];
    const lookup = (key: string) => key === songKey(heard);
    expect(ids(weekDiscoveries(ranked, makeCtx(), 30, lookup))).toEqual(['x1', 'new']);
    // The default reads the heard-set's registered lookup.
    registerHeardCheck(lookup);
    expect(ids(weekDiscoveries(ranked, makeCtx()))).toEqual(['x1', 'new']);
  });

  it('tops up from the explore source, whose picks may be by known artists, after the new artists', () => {
    const known = makeSong('h1', { artist: 'Known Singer' });
    const ctx = makeCtx({ history: [makePlay(known, Date.now())] });
    const ranked = [
      cand(makeSong('e1', { artist: 'Known Singer' }), 'explore'),
      cand(makeSong('n1', { artist: 'New One' })),
      cand(makeSong('k1', { artist: 'Known Singer' }), 'related'),
    ];
    expect(ids(weekDiscoveries(ranked, ctx, 30, undefined))).toEqual(['n1', 'e1']);
  });

  it('keeps at most three songs per lead artist and stops at the size asked', () => {
    const ranked = Array.from({ length: 5 }, (_, i) => cand(makeSong(`a${i}`, { artist: 'Same' })));
    expect(weekDiscoveries(ranked, makeCtx(), 30, undefined)).toHaveLength(3);
    const many = Array.from({ length: 60 }, (_, i) => cand(makeSong(`m${i}`, { artist: `Artist ${i}` })));
    expect(weekDiscoveries(many, makeCtx(), WEEK_SIZE, undefined)).toHaveLength(30);
  });
});

describe('the "New to you this week" mix', () => {
  it('holds the same 30 discovery picks', () => {
    const known = makeSong('h1', { artist: 'Known Singer' });
    const ctx = makeCtx({ history: [makePlay(known, Date.now())], pinnedLanguages: ['telugu'] });
    const ranked = [
      ...Array.from({ length: 10 }, (_, i) => cand(makeSong(`k${i}`, { artist: 'Known Singer' }))),
      ...Array.from({ length: 40 }, (_, i) => cand(makeSong(`n${i}`, { artist: `New ${i}` }))),
    ];
    const week = buildMixes(ranked, ctx).find((m) => m.kind === 'discover-weekly');
    expect(week?.songs).toHaveLength(30);
    expect(week?.songs.every((s) => s.artists[0].name !== 'Known Singer')).toBe(true);
    expect(ids(week!.songs)).toEqual(ids(weekDiscoveries(ranked, ctx)));
  });
});
