// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';
import { makeContext, makePlay, makeSong, warmProfile } from '@/__fixtures__/songs';

const rerank = vi.fn();
vi.mock('./recommendations', () => ({ aiRerankSongs: (...args: unknown[]) => rerank(...args) }));

import { curateTrending, trendingBrief } from './trending';

const NOW = 1_800_000_000_000;
const pool: Song[] = [
  makeSong('t1', { artist: 'Loved Artist' }),
  makeSong('t2', { artist: 'Someone' }),
  makeSong('t3', { artist: 'Another' }),
  makeSong('t4', { artist: 'Fourth' }),
  makeSong('t2-remix', { title: 'Song t2 (Remix)', artist: 'Someone' }),
  makeSong('muted', { artist: 'P', language: 'punjabi' }),
  makeSong('blocked', { artist: 'B' }),
  makeSong('junk', { title: 'Full Movie Jukebox', artist: 'J' }),
];
const ctx = (() => {
  const profile = warmProfile(NOW);
  profile.artists['artist-loved-artist'] = { name: 'Loved Artist', score: 40, plays: 30, completes: 25, skips: 0, lastTs: NOW };
  return makeContext({ profile, mutedLanguages: ['punjabi'], pinnedLanguages: ['telugu'], history: [makePlay(makeSong('h', { artist: 'Loved Artist' }), NOW - 86_400_000 * 20)] });
})();
const opts = { blocked: (s: Song) => s.id === 'blocked' };
const ids = (songs: Song[]) => songs.map((s) => s.id);

beforeEach(() => { rerank.mockReset(); });

describe('curateTrending', () => {
  it('applies the rules in code and orders by taste on the device when AI is off', async () => {
    const out = await curateTrending(pool, ctx, { ...opts, allowAi: false });
    expect(out.by).toBe('local');
    expect(ids(out.songs)[0]).toBe('t1'); // the artist this listener plays most leads
    expect(ids(out.songs).sort()).toEqual(['t1', 't2', 't3', 't4']); // no muted, blocked, junk or second cut of one song
    expect(rerank).not.toHaveBeenCalled();
  });

  it('lets the AI change the order — and only the order', async () => {
    rerank.mockImplementation(async (songs: Song[]) => [makeSong('invented', { artist: 'Ghost' }), ...[...songs].reverse()]);
    const out = await curateTrending(pool, ctx, { ...opts, allowAi: true });
    expect(out.by).toBe('ai');
    expect(ids(out.songs)).not.toContain('invented');
    expect(ids(out.songs).sort()).toEqual(['t1', 't2', 't3', 't4']);
    expect(ids(out.songs)[3]).toBe('t1');
  });

  it('ships the on-device order when the AI is slow, fails or returns nothing new', async () => {
    const local = ids((await curateTrending(pool, ctx, { ...opts, allowAi: false })).songs);
    rerank.mockImplementation(() => new Promise(() => undefined)); // never answers
    const slow = await curateTrending(pool, ctx, { ...opts, allowAi: true, budgetMs: 500 });
    expect(slow).toMatchObject({ by: 'local' });
    expect(ids(slow.songs)).toEqual(local);
    rerank.mockRejectedValueOnce(new Error('down'));
    expect((await curateTrending(pool, ctx, { ...opts, allowAi: true })).by).toBe('local');
    rerank.mockImplementationOnce(async (songs: Song[]) => songs); // the client's own fallback: unchanged order
    expect((await curateTrending(pool, ctx, { ...opts, allowAi: true })).by).toBe('local');
  });

  it('sends a brief with titles and artist names only', () => {
    const brief = JSON.parse(trendingBrief(ctx)) as Record<string, unknown>;
    expect(brief.artists).toContain('Loved Artist');
    expect(brief.avoidLanguages).toEqual(['punjabi']);
    expect(JSON.stringify(brief)).not.toMatch(/artist-loved-artist|"id"/);
  });
});
