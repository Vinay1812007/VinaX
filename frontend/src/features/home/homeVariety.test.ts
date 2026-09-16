import { describe, expect, it } from 'vitest';
import type { Song } from '@/types';
import { biasUnseenFirst, hashStr, rotatePage } from './homeVariety';

const song = (id: string): Song => ({
  kind: 'song', id, title: id, subtitle: 'A', artists: [{ id: 'a', name: 'A' }], album: null, images: [], audio: [],
  duration: 200, language: 'telugu', year: null, explicit: false, hasLyrics: false, playCount: null,
});

describe('home variety', () => {
  it('hashes stably and rotates pages within 1..max, differing across visits', () => {
    expect(hashStr('abc')).toBe(hashStr('abc'));
    expect(hashStr('abc')).not.toBe(hashStr('abd'));
    const pages = new Set<number>();
    for (let nonce = 0; nonce < 40; nonce += 1) {
      const p = rotatePage('telugu melodies', nonce, 0, 3);
      expect(p).toBeGreaterThanOrEqual(1);
      expect(p).toBeLessThanOrEqual(3);
      pages.add(p);
    }
    expect(pages.size).toBe(3);
    expect(rotatePage('q', 1, 0, 1)).toBe(1);
  });

  it('puts unseen songs first and keeps each group in order', () => {
    const list = [song('a'), song('b'), song('c'), song('d')];
    expect(biasUnseenFirst(list, new Set(['a', 'c'])).map((s) => s.id)).toEqual(['b', 'd', 'a', 'c']);
    expect(biasUnseenFirst(list, new Set())).toBe(list);
  });
});
