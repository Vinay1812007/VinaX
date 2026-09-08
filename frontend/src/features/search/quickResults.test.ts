import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';
import {
  clearQuickCache,
  fetchQuickResults,
  getCachedQuick,
  putCachedQuick,
  QUICK_CACHE_MAX,
  QUICK_LIMIT,
  QUICK_TTL_MS,
  quickCacheSize,
} from './quickResults';

const song = (id: string): Song => ({
  kind: 'song',
  id,
  title: id,
  subtitle: '',
  artists: [],
  album: null,
  images: [],
  audio: [],
  duration: null,
  language: null,
  year: null,
  explicit: false,
  hasLyrics: false,
  playCount: null,
});

describe('quick results cache (v5.19.0)', () => {
  beforeEach(() => clearQuickCache());

  it('caps entries at QUICK_LIMIT and expires them after the TTL', () => {
    const many = Array.from({ length: 10 }, (_, i) => song(`s${i}`));
    putCachedQuick('kesariya', many, 1000);
    expect(getCachedQuick('kesariya', 1000)?.length).toBe(QUICK_LIMIT);
    expect(getCachedQuick('kesariya', 1000 + QUICK_TTL_MS + 1)).toBeNull();
    expect(quickCacheSize()).toBe(0);
  });

  it('evicts the least recently used entry past QUICK_CACHE_MAX', () => {
    for (let i = 0; i < QUICK_CACHE_MAX; i += 1) putCachedQuick(`q${i}`, [song('x')]);
    getCachedQuick('q0'); // touch → q1 becomes the oldest
    putCachedQuick('overflow', [song('y')]);
    expect(quickCacheSize()).toBe(QUICK_CACHE_MAX);
    expect(getCachedQuick('q0')).not.toBeNull();
    expect(getCachedQuick('q1')).toBeNull();
  });

  it('fetches once per key and serves repeats from cache', async () => {
    const search = vi.fn(async () => [song('a'), song('b')]);
    expect((await fetchQuickResults('tum hi ho', undefined, search)).map((s) => s.id)).toEqual(['a', 'b']);
    expect((await fetchQuickResults('tum hi ho', undefined, search)).map((s) => s.id)).toEqual(['a', 'b']);
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith('tum hi ho', QUICK_LIMIT, { signal: undefined });
  });

  it('never caches a result that arrived after its request was aborted', async () => {
    const ctrl = new AbortController();
    const search = vi.fn(async () => {
      ctrl.abort();
      return [song('late')];
    });
    await expect(fetchQuickResults('late', ctrl.signal, search)).rejects.toMatchObject({ name: 'AbortError' });
    expect(getCachedQuick('late')).toBeNull();
  });
});
