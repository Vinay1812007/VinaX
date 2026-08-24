import { describe, expect, it } from 'vitest';
import { biasUnseenFirst, reorderByShelfMood, rotatePage } from './homeVariety';

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

describe('reorderByShelfMood — shelf reads to its title (A9)', () => {
  const s = (id: string, title: string) => ({ id, title, subtitle: '' });
  const shelf = [s('p', 'Party Dance Blast'), s('c', 'Chill Lofi Rain'), s('n', 'Some Track')];

  it('sinks mood-clashing songs to the back of a moody shelf', () => {
    const out = reorderByShelfMood('Chill late-night melodies', shelf);
    // 'c' (chill) + 'n' (neutral, flexes) stay ahead of the party clasher 'p'.
    expect(out.map((x) => x.id)).toEqual(['c', 'n', 'p']);
  });

  it('preserves order within the fitting group (relevance is never shuffled)', () => {
    const out = reorderByShelfMood('Weekend Party', [s('n', 'Neutral One'), s('d1', 'Dance Anthem'), s('d2', 'DJ Blast')]);
    expect(out.map((x) => x.id)).toEqual(['n', 'd1', 'd2']);
  });

  it('is a no-op for a neutral title, a short shelf, or when nothing clashes', () => {
    expect(reorderByShelfMood('Ilaiyaraaja essentials', shelf)).toBe(shelf);
    const two = [s('a', 'Party'), s('b', 'Sad')];
    expect(reorderByShelfMood('Party night', two)).toBe(two);
  });
});
