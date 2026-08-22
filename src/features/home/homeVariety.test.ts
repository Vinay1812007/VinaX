import { describe, expect, it } from 'vitest';
import { biasUnseenFirst, rotatePage } from './homeVariety';

describe('rotatePage — per-visit page rotation', () => {
  it('returns a page in 1..pages', () => {
    for (let n = 0; n < 50; n += 1) {
      const p = rotatePage('telugu melodies', n * 7919, n % 5, 3);
      expect(p).toBeGreaterThanOrEqual(1);
      expect(p).toBeLessThanOrEqual(3);
    }
  });

  it('is deterministic for a given (query, nonce, idx)', () => {
    expect(rotatePage('hindi hits', 12345, 0)).toBe(rotatePage('hindi hits', 12345, 0));
  });

  it('varies across visit nonces so Home does not repeat its pages every open', () => {
    const pages = new Set(
      Array.from({ length: 12 }, (_, i) => rotatePage('a.r. rahman hits', 1000 + i * 104729, 1, 3)),
    );
    // A deterministic date%3 scheme would collapse to a single value here.
    expect(pages.size).toBeGreaterThan(1);
  });
});

describe('biasUnseenFirst — soft anti-repeat that never starves a shelf', () => {
  const songs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];

  it('keeps every song (no starving), just reordered', () => {
    const out = biasUnseenFirst(songs, new Set(['a', 'c']));
    expect(out.map((s) => s.id).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('puts not-recently-seen songs first, preserving rank order within each group', () => {
    const out = biasUnseenFirst(songs, new Set(['a', 'b']));
    expect(out.map((s) => s.id)).toEqual(['c', 'd', 'a', 'b']);
  });

  it('is a no-op when nothing was seen recently', () => {
    const out = biasUnseenFirst(songs, new Set());
    expect(out).toBe(songs);
  });
});
