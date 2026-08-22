import { describe, expect, it } from 'vitest';
import { excludeRecent, rotateTop } from './variety';
import type { ScoredCandidate } from './types';

/** Minimal ScoredCandidate for pure-function tests. */
function sc(id: string, score = 1): ScoredCandidate {
  return {
    candidate: {
      // Only .song.id is read by these helpers.
      song: { id } as unknown as ScoredCandidate['candidate']['song'],
      source: 'related',
    },
    score,
    reasons: [],
  };
}

describe('rotateTop — seeded rotation of the leading picks', () => {
  const list = Array.from({ length: 12 }, (_, i) => sc(`s${i}`, 12 - i));

  it('keeps exactly the same set of songs (nothing added or dropped)', () => {
    const out = rotateTop(list, 42);
    expect(out.map((c) => c.candidate.song.id).sort()).toEqual(list.map((c) => c.candidate.song.id).sort());
  });

  it('produces different leading orders for different salts (same seed → different chain)', () => {
    const a = rotateTop(list, 1).map((c) => c.candidate.song.id).join(',');
    const b = rotateTop(list, 999999).map((c) => c.candidate.song.id).join(',');
    expect(a).not.toBe(b);
  });

  it('is reproducible for a given salt', () => {
    expect(rotateTop(list, 7).map((c) => c.candidate.song.id)).toEqual(
      rotateTop(list, 7).map((c) => c.candidate.song.id),
    );
  });

  it('leaves tails past the window untouched', () => {
    const out = rotateTop(list, 5, 4);
    expect(out.slice(4).map((c) => c.candidate.song.id)).toEqual(list.slice(4).map((c) => c.candidate.song.id));
  });

  it('never mutates the input array', () => {
    const before = list.map((c) => c.candidate.song.id);
    rotateTop(list, 123);
    expect(list.map((c) => c.candidate.song.id)).toEqual(before);
  });
});

describe('excludeRecent — recently-played / queued exclusion', () => {
  const list = [sc('a'), sc('b'), sc('c'), sc('d')];

  it('drops candidates whose id is in the recent set', () => {
    const out = excludeRecent(list, new Set(['b', 'd']));
    expect(out.map((c) => c.candidate.song.id)).toEqual(['a', 'c']);
  });

  it('is a no-op for an empty recent set', () => {
    expect(excludeRecent(list, new Set())).toBe(list);
  });
});
