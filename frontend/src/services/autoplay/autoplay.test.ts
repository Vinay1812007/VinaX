// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';

const recommendFromSeeds = vi.fn(async (_seeds: Song[], _opts?: unknown): Promise<Song[]> => []);
const songsLikeThis = vi.fn(async (_song: Song, _opts?: unknown): Promise<Song[]> => []);
vi.mock('@/services/recs/similar', () => ({
  recommendFromSeeds: (seeds: Song[], opts?: unknown) => recommendFromSeeds(seeds, opts),
  songsLikeThis: (song: Song, opts?: unknown) => songsLikeThis(song, opts),
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

beforeEach(() => {
  recommendFromSeeds.mockReset().mockResolvedValue([]);
  songsLikeThis.mockReset().mockResolvedValue([]);
  useSettingsStore.setState({ kidMode: false, mutedLanguages: [] });
  useLibraryStore.setState({ hiddenSongIds: [], hiddenArtists: [] });
  useHistoryStore.setState({ entries: [] });
});

describe('Autoplay', () => {
  it('seeds from the playing song and the ones before it, newest first, no repeats', () => {
    const q = [song('a'), song('b'), song('a'), song('c')];
    expect(autoplaySeeds(q, 3).map((s) => s.id)).toEqual(['c', 'a', 'b']);
  });

  it('keeps only songs that may play: not queued, not recently played, not hidden, muted or explicit under Kid mode', () => {
    useSettingsStore.setState({ kidMode: true, mutedLanguages: ['hindi'] });
    useLibraryStore.setState({ hiddenSongIds: ['hidden'], hiddenArtists: [] });
    useHistoryStore.setState({ entries: [{ song: song('recent'), ts: 1, completed: true }] });
    const picked = pickAutoplay(
      [song('ok'), song('inq'), song('recent'), song('hidden'), song('rude', { explicit: true }), song('hi', { language: 'hindi' }), song('ok')],
      [song('inq')],
    );
    expect(picked.map((s) => s.id)).toEqual(['ok']);
  });

  it('asks the Worker with the seeds, and falls back to the catalogue when it finds too little', async () => {
    recommendFromSeeds.mockResolvedValue([song('w1')]);
    songsLikeThis.mockResolvedValue([song('c1'), song('c2')]);
    const out = await findAutoplaySongs([song('a'), song('b')], 1);
    expect(recommendFromSeeds.mock.calls[0][0].map((s) => s.id)).toEqual(['b', 'a']);
    expect(out.map((s) => s.id)).toEqual(['w1', 'c1', 'c2']);
  });

  it('gives nothing for a queue of podcast episodes', async () => {
    const ep = song('ep', { audio: [{ quality: 'original', url: 'https://x/ep.mp3' }] } as Partial<Song>);
    expect(await findAutoplaySongs([ep], 0)).toEqual([]);
    expect(recommendFromSeeds).not.toHaveBeenCalled();
  });
});
