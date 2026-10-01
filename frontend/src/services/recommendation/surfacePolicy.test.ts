import { describe, expect, it } from 'vitest';
import { makePlay, makeSong } from '@/__fixtures__/songs';
import { surfaceOrder, surfaceSignals, NO_SIGNALS, RECENT_WINDOW } from './surfacePolicy';
import { songKey } from './songIdentity';

/** 9.0.0 — every surface applies one repetition rule for its own purpose. */
const a = makeSong('a', { artist: 'A' });
const b = makeSong('b', { artist: 'B' });
const c = makeSong('c', { artist: 'C' });
const d = makeSong('d', { artist: 'D' });
const ids = (songs: Array<{ id: string }>) => songs.map((s) => s.id);

describe('surfaceOrder', () => {
  // `a` was just heard, `b` was skipped this sitting, `c` was shown on Home this week, `d` is fresh.
  const signals = surfaceSignals([makePlay(a, 1)], ['b'], [songKey(c)]);

  it('resume shelves (Continue listening, On repeat…) keep recent plays: they are the content', () => {
    expect(ids(surfaceOrder([a, b, c, d], 'resume', signals))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('personal shelves move heard, skipped and shown songs to the back, never off the shelf', () => {
    expect(ids(surfaceOrder([a, b, c, d], 'personal', signals))).toEqual(['d', 'a', 'b', 'c']);
  });

  it('discovery shelves drop heard and skipped songs, and sink songs shown elsewhere', () => {
    expect(ids(surfaceOrder([a, b, c, d], 'discovery', signals))).toEqual(['d', 'c']);
  });

  it('recognises another cut of a song heard minutes ago (canonical identity)', () => {
    const remaster = makeSong('a2', { title: `${a.title} (2019 Remaster)`, artist: 'A' });
    expect(ids(surfaceOrder([remaster, d], 'discovery', signals))).toEqual(['d']);
  });

  it('only the last plays count as recent, like the queue’s window', () => {
    const history = Array.from({ length: RECENT_WINDOW + 1 }, (_, i) => makePlay(makeSong(`h${i}`, { artist: `H${i}` }), 1000 - i));
    const s = surfaceSignals(history, [], []);
    expect(s.recentKeys.size).toBe(RECENT_WINDOW);
    expect(s.recentKeys.has(songKey(history[RECENT_WINDOW].song))).toBe(false);
  });

  it('with no signals every surface keeps the list as it is', () => {
    for (const kind of ['resume', 'personal', 'discovery'] as const) expect(ids(surfaceOrder([a, b, c, d], kind, NO_SIGNALS))).toEqual(['a', 'b', 'c', 'd']);
  });
});
