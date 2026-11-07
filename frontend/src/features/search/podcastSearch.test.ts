import { describe, expect, it, vi } from 'vitest';
import type { PodcastSummary } from '@/services/api/catalog';
import { loadAllPodcasts, matchPodcasts } from './podcastSearch';

const show = (id: string, name: string): PodcastSummary => ({ id, name, season: null, releaseDate: null, explicit: false, images: [] });
const all = [
  show('1', 'Talking Music'),
  show('2', 'Arijit Uvaach'),
  show('3', 'Kahaani Express with Neelesh Misra'),
  show('4', 'Music'),
  show('5', 'Café Talks'),
];

describe('matchPodcasts', () => {
  it('ranks the exact name, then prefix, then contains', () => {
    expect(matchPodcasts(all, 'music').map((p) => p.id)).toEqual(['4', '1']);
  });
  it('matches word prefixes in any order', () => {
    expect(matchPodcasts(all, 'neelesh kahaani').map((p) => p.id)).toEqual(['3']);
    expect(matchPodcasts(all, 'arijit').map((p) => p.id)).toEqual(['2']);
  });
  it('ignores case and accents', () => {
    expect(matchPodcasts(all, 'CAFE').map((p) => p.id)).toEqual(['5']);
  });
  it('needs two characters', () => {
    expect(matchPodcasts(all, 'a')).toEqual([]);
  });
});

describe('loadAllPodcasts', () => {
  it('walks pages until a short one and drops repeats', async () => {
    const page1 = Array.from({ length: 50 }, (_, i) => show(`p${i}`, `Show ${i}`));
    const fetchPage = vi.fn(async (page: number) => (page === 1 ? page1 : [show('p0', 'Show 0'), show('x', 'Extra')]));
    const out = await loadAllPodcasts(fetchPage as never);
    expect(out).toHaveLength(51);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });
  it('fails when the first page fails, so the list is retried later', async () => {
    await expect(loadAllPodcasts((async () => Promise.reject(new Error('down'))) as never)).rejects.toThrow();
  });
});
