// @vitest-environment jsdom
/**
 * 1.3 — catalogue stations: the opening batch plays first (as radio seeds),
 * the rest of it and then the station's next songs feed the player's top-up.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';

const startFeatured = vi.fn();
const startArtist = vi.fn();
vi.mock('@/services/api', () => ({
  getRadioStations: vi.fn(),
  nextStationSongs: vi.fn(),
  startFeaturedStation: (...a: unknown[]) => startFeatured(...a),
  startArtistRadio: (...a: unknown[]) => startArtist(...a),
}));
vi.mock('@/services/personalization/updater', () => ({
  recordComplete: vi.fn(), recordPlay: vi.fn(), recordQueueAdd: vi.fn(), recordSkip: vi.fn(), recordFavorite: vi.fn(), recordDislike: vi.fn(), recordPlaylistAdd: vi.fn(),
}));

import { playArtistStation, playFeaturedStation, playStation, stationFeed } from './stations';
import { usePlayerStore, type RadioFeed } from '@/store/playerStore';
import { useLibraryStore } from '@/store/libraryStore';
import { makeSong } from '@/__fixtures__/songs';

const songs = (n: number, prefix = 's'): Song[] => Array.from({ length: n }, (_, i) => makeSong(`${prefix}${i}`, { artist: `Artist ${i}` }));
const signal = new AbortController().signal;
const startRadio = vi.fn();

beforeEach(() => {
  startFeatured.mockReset();
  startArtist.mockReset();
  startRadio.mockReset();
  usePlayerStore.setState({ startRadio });
  useLibraryStore.setState({ hiddenSongIds: [], hiddenArtists: [] });
});

describe('stationFeed', () => {
  it('hands out what the opening batch left over first, then asks the station', async () => {
    const next = vi.fn(async () => songs(10, 'n'));
    const feed = stationFeed('st-1', songs(7, 'r'), next);
    expect((await feed(5, signal)).map((s) => s.id)).toEqual(['r0', 'r1', 'r2', 'r3', 'r4']);
    expect((await feed(5, signal)).map((s) => s.id)).toEqual(['r5', 'r6']);
    expect(next).not.toHaveBeenCalled();
    expect((await feed(5, signal)).map((s) => s.id)).toEqual(['n0', 'n1', 'n2', 'n3', 'n4']);
    expect(next).toHaveBeenCalledWith('st-1', 10, { signal });
    // The rest of that call is kept for the next top-up.
    expect((await feed(5, signal)).map((s) => s.id)).toEqual(['n5', 'n6', 'n7', 'n8', 'n9']);
    expect(next).toHaveBeenCalledOnce();
  });

  it('without a station id it ends with the opening batch', async () => {
    const next = vi.fn(async () => songs(3));
    const feed = stationFeed(null, songs(2), next);
    expect(await feed(5, signal)).toHaveLength(2);
    expect(await feed(5, signal)).toEqual([]);
    expect(next).not.toHaveBeenCalled();
  });

  it('a station that stops answering rejects, so the player falls back to the DJ', async () => {
    const feed = stationFeed('st-1', [], vi.fn(async () => Promise.reject(new Error('down'))));
    await expect(feed(5, signal)).rejects.toThrow('down');
  });
});

describe('playStation', () => {
  it('plays the first songs as radio seeds and hands the rest to the feed', async () => {
    const next = vi.fn(async () => [] as Song[]);
    const head = await playStation(async () => ({ stationId: 'st-9', songs: songs(12) }), next);
    expect(head.map((s) => s.id)).toEqual(['s0', 's1', 's2', 's3', 's4']);
    expect(startRadio).toHaveBeenCalledOnce();
    const [seed, opts] = startRadio.mock.calls[0] as [Song, { seeds: Song[]; feed: RadioFeed }];
    expect(seed.id).toBe('s0');
    expect(opts.seeds.map((s) => s.id)).toEqual(['s1', 's2', 's3', 's4']);
    expect((await opts.feed(10, signal)).map((s) => s.id)).toEqual(['s5', 's6', 's7', 's8', 's9', 's10', 's11']);
  });

  it('leaves out songs the listener has hidden', async () => {
    useLibraryStore.setState({ hiddenSongIds: ['s0'], hiddenArtists: [] });
    await playStation(async () => ({ stationId: 'x', songs: songs(3) }));
    expect((startRadio.mock.calls[0] as [Song])[0].id).toBe('s1');
  });

  it('rejects (and plays nothing) when the station cannot open or has nothing playable', async () => {
    await expect(playStation(async () => Promise.reject(new Error('404')))).rejects.toThrow('404');
    useLibraryStore.setState({ hiddenSongIds: ['s0'], hiddenArtists: [] });
    await expect(playStation(async () => ({ stationId: 'x', songs: songs(1) }))).rejects.toThrow('station_empty');
    expect(startRadio).not.toHaveBeenCalled();
  });

  it('featured and artist stations open the right catalogue station', async () => {
    startFeatured.mockResolvedValue({ stationId: 'f', songs: songs(2) });
    startArtist.mockResolvedValue({ stationId: 'a', songs: songs(2) });
    await playFeaturedStation({ name: 'Retro Spin', language: 'hindi' });
    expect(startFeatured).toHaveBeenCalledWith('Retro Spin', 'hindi', 15, undefined);
    await playArtistStation('459320');
    expect(startArtist).toHaveBeenCalledWith('459320', 15, undefined);
    expect(startRadio).toHaveBeenCalledTimes(2);
  });
});
