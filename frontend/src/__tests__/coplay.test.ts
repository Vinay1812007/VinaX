/**
 * Roadmap O.3 — on-device co-play similarity. Pins the sessionization rules
 * (30-min gap splits), the unordered-pair counting, log damping/normalization,
 * and the "same artist is not co-play" guard. Everything here runs on local
 * history only — the engine has no I/O to mock, which is the point.
 */
import { describe, expect, it } from 'vitest';
import type { HistoryEntry, Song } from '@/types';
import { buildCoPlayIndex, coPlayAffinity, coPlayIndexFor } from '../services/recommendation/coplay';

let seq = 0;
function song(artists: string[]): Song {
  seq += 1;
  return {
    kind: 'song',
    id: `s${seq}`,
    title: `Track ${seq}`,
    subtitle: artists.join(', '),
    artists: artists.map((name, i) => ({ id: `a-${name}-${i}`, name, image: null })),
    album: null,
    images: [],
    audio: [],
    duration: 180,
    language: null,
    year: '2024',
    explicit: false,
    hasLyrics: false,
    playCount: null,
  };
}

const MIN = 60_000;

/** Build newest-first history (as the store keeps it) from oldest-first plays. */
function history(plays: Array<{ artists: string[]; at: number }>): HistoryEntry[] {
  return plays
    .map((p) => ({ song: song(p.artists), ts: p.at, completed: true }))
    .reverse();
}

describe('buildCoPlayIndex — sessionization', () => {
  it('counts unordered pairs for artists played within the same 30-min session', () => {
    const idx = buildCoPlayIndex(
      history([
        { artists: ['anirudh'], at: 0 },
        { artists: ['dsp'], at: 5 * MIN },
      ]),
    );
    expect(idx.size).toBe(1);
    expect(idx.get('anirudh', 'dsp')).toBeGreaterThan(0);
    expect(idx.get('dsp', 'anirudh')).toBe(idx.get('anirudh', 'dsp')); // unordered
  });

  it('a >30-min gap splits sessions — artists across the gap never pair', () => {
    const idx = buildCoPlayIndex(
      history([
        { artists: ['anirudh'], at: 0 },
        { artists: ['dsp'], at: 31 * MIN },
      ]),
    );
    expect(idx.size).toBe(0);
    expect(idx.get('anirudh', 'dsp')).toBe(0);
  });

  it('log-damps repeat sessions so one binge cannot dominate', () => {
    // Pair A co-plays in 8 sessions, pair B in 1 — damped ratio is log2(9)/log2(2) ≈ 3.17, not 8.
    const plays: Array<{ artists: string[]; at: number }> = [];
    for (let s = 0; s < 8; s++) {
      plays.push({ artists: ['xavier rao'], at: s * 60 * MIN });
      plays.push({ artists: ['yamini sen'], at: s * 60 * MIN + 2 * MIN });
    }
    plays.push({ artists: ['pritam'], at: 900 * MIN });
    plays.push({ artists: ['qadir khan'], at: 902 * MIN });
    const idx = buildCoPlayIndex(history(plays));
    const ratio = idx.get('xavier rao', 'yamini sen') / idx.get('pritam', 'qadir khan');
    expect(ratio).toBeGreaterThan(1);
    expect(ratio).toBeLessThan(4); // damped well below the raw 8x
    expect(idx.max).toBe(idx.get('xavier rao', 'yamini sen'));
  });
});

describe('coPlayAffinity', () => {
  const idx = buildCoPlayIndex(
    history([
      { artists: ['anirudh'], at: 0 },
      { artists: ['dsp'], at: 3 * MIN },
      { artists: ['dsp'], at: 6 * MIN },
    ]),
  );

  it('returns the normalized 0..1 strength between two songs by co-played artists', () => {
    const v = coPlayAffinity(idx, song(['anirudh']), song(['dsp']));
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThanOrEqual(1);
    expect(coPlayAffinity(idx, song(['anirudh']), song(['dsp']))).toBe(1); // the max pair normalizes to 1
  });

  it('same-artist candidates score 0 — that is the artist signal, not co-play', () => {
    expect(coPlayAffinity(idx, song(['dsp']), song(['dsp']))).toBe(0);
  });

  it('unknown artists and empty histories return 0, never NaN', () => {
    expect(coPlayAffinity(idx, song(['nobody']), song(['dsp']))).toBe(0);
    const empty = buildCoPlayIndex([]);
    expect(empty.size).toBe(0);
    expect(coPlayAffinity(empty, song(['anirudh']), song(['dsp']))).toBe(0);
  });

  it('songs with no usable artist metadata return 0', () => {
    expect(coPlayAffinity(idx, song([]), song(['dsp']))).toBe(0);
    expect(coPlayAffinity(idx, song(['anirudh']), song([]))).toBe(0);
  });
});

describe('coPlayIndexFor — memoization', () => {
  it('reuses the index for identical history identity, rebuilds when it changes', () => {
    const h1 = history([
      { artists: ['anirudh'], at: 0 },
      { artists: ['dsp'], at: 3 * MIN },
    ]);
    const first = coPlayIndexFor(h1);
    expect(coPlayIndexFor(h1)).toBe(first); // same key → same object
    const h2 = [{ song: song(['thaman']), ts: 99 * MIN, completed: true }, ...h1];
    const rebuilt = coPlayIndexFor(h2);
    expect(rebuilt).not.toBe(first);
  });
});
