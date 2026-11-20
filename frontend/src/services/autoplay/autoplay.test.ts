// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';

const recommendFromSeeds = vi.fn(async (_seeds: Song[], _opts?: unknown): Promise<Song[]> => []);
vi.mock('@/services/recs/similar', () => ({
  recommendFromSeeds: (seeds: Song[], opts?: unknown) => recommendFromSeeds(seeds, opts),
}));
const suggestions = vi.fn(async (_id: string): Promise<Song[]> => []);
const artistSongs = vi.fn(async (_id: string): Promise<Song[]> => []);
const search = vi.fn(async (_q: string): Promise<Song[]> => []);
vi.mock('@/services/api/saavn', () => ({
  getSongSuggestions: (id: string) => suggestions(id),
  getArtistTopSongs: (id: string) => artistSongs(id),
  searchSongs: (q: string) => search(q),
}));

import { autoplaySeeds, findAutoplaySongs, pickAutoplay } from './index';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useHistoryStore } from '@/store/historyStore';

const song = (id: string, over: Partial<Song> = {}): Song => ({
  kind: 'song', id, title: `Song ${id}`, subtitle: `Artist ${id}`, artists: [{ id: `ar-${id}`, name: `Artist ${id}` }], album: null,
  images: [], audio: [{ quality: '320kbps', url: `https://x/${id}.mp4` }], duration: 200, language: 'telugu', year: '2024',
  explicit: false, hasLyrics: false, playCount: null, ...over,
} as unknown as Song);
const ids = (songs: Song[]) => songs.map((s) => s.id);
const played = (...songs: Song[]) => useHistoryStore.setState({ entries: songs.map((s, i) => ({ song: s, ts: 100 - i, completed: true })) });

beforeEach(() => {
  for (const m of [recommendFromSeeds, suggestions, artistSongs, search]) m.mockReset().mockResolvedValue([]);
  useSettingsStore.setState({ kidMode: false, mutedLanguages: [] });
  useLibraryStore.setState({ hiddenSongIds: [], hiddenArtists: [] });
  useHistoryStore.setState({ entries: [] });
});

describe('Autoplay', () => {
  it('seeds from the playing song and the ones before it, newest first, no repeats', () => {
    const q = [song('a'), song('b'), song('a'), song('c')];
    expect(ids(autoplaySeeds(q, 3))).toEqual(['c', 'a', 'b']);
  });

  it('keeps only songs that may play: not queued, not recently played, not hidden, muted or explicit under Kid mode', () => {
    useSettingsStore.setState({ kidMode: true, mutedLanguages: ['hindi'] });
    useLibraryStore.setState({ hiddenSongIds: ['hidden'], hiddenArtists: [] });
    played(song('recent'));
    const picked = pickAutoplay(
      [song('ok'), song('inq'), song('recent'), song('hidden'), song('rude', { explicit: true }), song('hi', { language: 'hindi' }), song('ok')],
      [song('inq')],
    );
    expect(ids(picked)).toEqual(['ok']);
  });

  it('two versions of one song are one pick', () => {
    const picked = pickAutoplay([song('v1', { title: 'Yeshanagula (From "The Paradise") (Telugu)' }), song('v2', { title: 'Yeshanagula' }), song('o', { title: 'Other' })], []);
    expect(ids(picked)).toEqual(['v1', 'o']);
  });

  it('asks the Worker first and stops there when it finds enough', async () => {
    recommendFromSeeds.mockResolvedValue([song('w1'), song('w2'), song('w3')]);
    const out = await findAutoplaySongs([song('a'), song('b')], 1);
    expect(ids(recommendFromSeeds.mock.calls[0][0])).toEqual(['b', 'a']);
    expect(ids(out)).toEqual(['w1', 'w2', 'w3']);
    expect(suggestions).not.toHaveBeenCalled();
  });

  it('widens to the catalogue’s suggestions, then the artist’s songs, then popular songs in the language', async () => {
    suggestions.mockResolvedValue([song('s1')]);
    artistSongs.mockResolvedValue([song('ar1')]);
    search.mockResolvedValue([song('pop1'), song('pop2')]);
    const out = await findAutoplaySongs([song('a')], 0);
    expect(ids(out)).toEqual(['s1', 'ar1', 'pop1', 'pop2']);
    expect(artistSongs).toHaveBeenCalledWith('ar-a');
    expect(search.mock.calls[0][0]).toMatch(/telugu/);
  });

  it('songs not heard lately come first, from any source, before a recent one is let back in', async () => {
    const similar = ['r1', 'r2', 'r3'].map((id) => song(id));
    played(...similar);
    suggestions.mockResolvedValue(similar);
    search.mockResolvedValue([song('new1'), song('new2'), song('new3')]);
    expect(ids(await findAutoplaySongs([song('a')], 0))).toEqual(['new1', 'new2', 'new3']);
  });

  it('1.20.1 — when every similar song was played lately, it still plays some rather than stop', async () => {
    const similar = ['r1', 'r2', 'r3', 'r4'].map((id) => song(id));
    played(...Array.from({ length: 12 }, (_, i) => song(`x${i}`)), ...similar);
    suggestions.mockResolvedValue(similar);
    // Played more than 10 plays ago: the second step lets them back.
    expect(ids(await findAutoplaySongs([song('a')], 0))).toEqual(['r1', 'r2', 'r3', 'r4']);
    // Played just now: the last step still does, but never a song waiting in the queue.
    played(...similar);
    expect(ids(await findAutoplaySongs([song('r1'), song('a')], 1))).toEqual(['r2', 'r3', 'r4']);
  });

  it('gives nothing for a queue of podcast episodes', async () => {
    const ep = song('ep', { audio: [{ quality: 'original', url: 'https://x/ep.mp3' }] } as Partial<Song>);
    expect(await findAutoplaySongs([ep], 0)).toEqual([]);
    expect(recommendFromSeeds).not.toHaveBeenCalled();
  });
});
