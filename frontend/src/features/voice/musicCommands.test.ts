import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  searchSongs: vi.fn(),
  player: { isPlaying: false, queue: [] as unknown[], togglePlay: vi.fn(), next: vi.fn(), prev: vi.fn(), enqueueNext: vi.fn(), playQueue: vi.fn() },
}));
vi.mock('@/services/api', () => ({ searchSongs: h.searchSongs }));
vi.mock('@/store/playerStore', () => ({ usePlayerStore: { getState: () => h.player } }));

import { tryMusicCommand } from './musicCommands';

const song = (title: string, subtitle: string, language: string) => ({ id: `${title}-${language}`, title, subtitle, language });

beforeEach(() => {
  h.searchSongs.mockReset();
  h.player.playQueue.mockReset();
  h.player.enqueueNext.mockReset();
});

describe('tryMusicCommand', () => {
  it('searches for the whole title when it merely ends in "in <word>"', async () => {
    h.searchSongs.mockResolvedValue([song('Love in Tokyo', 'A Singer', 'hindi')]);
    const said: string[] = [];
    expect(await tryMusicCommand('play Love in Tokyo', (l) => said.push(l))).toBe(true);
    expect(h.searchSongs).toHaveBeenCalledWith('Love in Tokyo', 8);
    expect(said[0]).toBe('Playing Love in Tokyo by A Singer.');
  });

  it('still filters by a real language', async () => {
    const telugu = song('Kesariya', 'A Singer', 'telugu');
    h.searchSongs.mockResolvedValue([song('Kesariya', 'A Singer', 'hindi'), telugu]);
    const said: string[] = [];
    expect(await tryMusicCommand('play Kesariya in Telugu', (l) => said.push(l))).toBe(true);
    expect(h.searchSongs).toHaveBeenCalledWith('Kesariya', 8);
    expect(h.player.playQueue).toHaveBeenCalledWith([telugu], 0);
    expect(said[0]).toContain('(in telugu)');
  });

  it('drops the full stop dictation adds, and the filler before it', async () => {
    h.searchSongs.mockResolvedValue([song('Kesariya', 'A Singer', 'hindi')]);
    expect(await tryMusicCommand('Play Kesariya.', () => {})).toBe(true);
    expect(h.searchSongs).toHaveBeenLastCalledWith('Kesariya', 8);
    expect(await tryMusicCommand('Queue Kesariya please.', () => {})).toBe(true);
    expect(h.searchSongs).toHaveBeenLastCalledWith('Kesariya', 8);
    expect(h.player.enqueueNext).toHaveBeenCalledTimes(1);
  });

  it('leaves ordinary questions to the assistant', async () => {
    expect(await tryMusicCommand('what is a raga?', () => {})).toBe(false);
    expect(h.searchSongs).not.toHaveBeenCalled();
  });
});
