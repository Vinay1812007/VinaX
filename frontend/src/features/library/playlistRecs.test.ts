import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSong } from '@/__fixtures__/songs';
import type { Song } from '@/types';

const { recommendFromSeeds } = vi.hoisted(() => ({ recommendFromSeeds: vi.fn() }));
vi.mock('@/services/recs/similar', () => ({ recommendFromSeeds }));

import { excludeIds, fetchPlaylistRecs, MAX_SEEDS, pickSeeds, visibleRecs } from './playlistRecs';

const ids = (list: Song[]) => list.map((s) => s.id);

describe('pickSeeds', () => {
  it('takes five at most, one per artist first', () => {
    const songs = [
      makeSong('a1', { artist: 'A' }), makeSong('a2', { artist: 'A' }), makeSong('a3', { artist: 'A' }),
      makeSong('b1', { artist: 'B' }), makeSong('c1', { artist: 'C' }), makeSong('d1', { artist: 'D' }),
      makeSong('e1', { artist: 'E' }), makeSong('f1', { artist: 'F' }),
    ];
    const seeds = pickSeeds(songs, 0);
    expect(seeds).toHaveLength(MAX_SEEDS);
    expect(new Set(seeds.map((s) => s.artists[0].id)).size).toBe(MAX_SEEDS);
    expect(ids(seeds)).toEqual(['a1', 'b1', 'c1', 'd1', 'e1']);
  });

  it('rotates to other songs on the next round', () => {
    const songs = Array.from({ length: 12 }, (_, i) => makeSong(`s${i}`, { artist: `Artist ${i}` }));
    const r0 = ids(pickSeeds(songs, 0));
    const r1 = ids(pickSeeds(songs, 1));
    expect(r0).toEqual(['s0', 's1', 's2', 's3', 's4']);
    expect(r1).toEqual(['s5', 's6', 's7', 's8', 's9']);
    expect(r1.some((id) => r0.includes(id))).toBe(false);
  });

  it('moves to another song of the same artist when the rounds come back around', () => {
    const songs = [makeSong('a1', { artist: 'A' }), makeSong('a2', { artist: 'A' }), makeSong('b1', { artist: 'B' }), makeSong('b2', { artist: 'B' })];
    expect(ids(pickSeeds(songs, 0, 2))).toEqual(['a1', 'b1']);
    expect(ids(pickSeeds(songs, 1, 2))).toEqual(['a2', 'b2']);
  });

  it('fills from the same artists when the playlist has fewer than five', () => {
    const songs = [makeSong('a1', { artist: 'A' }), makeSong('a2', { artist: 'A' }), makeSong('a3', { artist: 'A' }), makeSong('b1', { artist: 'B' })];
    const seeds = ids(pickSeeds(songs, 0));
    expect(seeds).toHaveLength(4);
    expect(new Set(seeds).size).toBe(4);
  });

  it('skips duplicate songs and handles an empty playlist', () => {
    expect(pickSeeds([], 0)).toEqual([]);
    const a = makeSong('a');
    expect(ids(pickSeeds([a, a, a], 3))).toEqual(['a']);
  });
});

describe('excludeIds', () => {
  it('puts shown songs before the playlist and stays under the route cap', () => {
    const playlist = Array.from({ length: 200 }, (_, i) => makeSong(`p${i}`));
    const out = excludeIds(playlist, ['x', 'y']);
    expect(out.slice(0, 2)).toEqual(['x', 'y']);
    expect(out.length).toBeLessThanOrEqual(95);
  });
});

describe('visibleRecs', () => {
  it('drops playlist songs, unsafe songs and repeats, ten at most', () => {
    const recs = [makeSong('in'), makeSong('hidden'), makeSong('ok'), makeSong('ok'), ...Array.from({ length: 15 }, (_, i) => makeSong(`r${i}`))];
    const out = visibleRecs(recs, [makeSong('in')], (s) => s.id !== 'hidden');
    expect(out).toHaveLength(10);
    expect(ids(out)[0]).toBe('ok');
    expect(ids(out)).not.toContain('in');
    expect(ids(out)).not.toContain('hidden');
    expect(new Set(ids(out)).size).toBe(10);
  });
});

describe('fetchPlaylistRecs', () => {
  beforeEach(() => recommendFromSeeds.mockReset());

  it('asks with the round seeds and excludes, and filters the playlist on the device too', async () => {
    const playlist = [makeSong('p1', { artist: 'A' }), makeSong('p2', { artist: 'B' })];
    recommendFromSeeds.mockResolvedValue([makeSong('p1'), makeSong('n1'), makeSong('n2')]);
    const out = await fetchPlaylistRecs(playlist, 0, new Set());
    expect(ids(out)).toEqual(['n1', 'n2']);
    const [seeds, opts] = recommendFromSeeds.mock.calls[0];
    expect(ids(seeds)).toEqual(['p1', 'p2']);
    expect(opts.exclude).toEqual(['p1', 'p2']);
    expect(opts.limit).toBe(20);
  });

  it('leaves out songs shown before, unless nothing new came back', async () => {
    const playlist = [makeSong('p1')];
    recommendFromSeeds.mockResolvedValue([makeSong('old'), makeSong('new')]);
    expect(ids(await fetchPlaylistRecs(playlist, 1, new Set(['old'])))).toEqual(['new']);
    recommendFromSeeds.mockResolvedValue([makeSong('old')]);
    expect(ids(await fetchPlaylistRecs(playlist, 2, new Set(['old'])))).toEqual(['old']);
  });

  it('does not call the route for an empty playlist', async () => {
    expect(await fetchPlaylistRecs([], 0, new Set())).toEqual([]);
    expect(recommendFromSeeds).not.toHaveBeenCalled();
  });
});
