// @vitest-environment jsdom
/** Live voice music control: each tool against VinaX's player, and what Gemini is told back. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  search: vi.fn(),
  player: { queue: [] as unknown[], index: 0, isPlaying: false, playQueue: vi.fn(), togglePlay: vi.fn(), next: vi.fn(), prev: vi.fn() },
}));
vi.mock('@/services/api', () => ({ searchSongs: h.search }));
vi.mock('@/store/playerStore', () => ({ usePlayerStore: { getState: () => h.player } }));

import { MUSIC_TOOL_NAMES, runMusicTool } from './musicTools';

const song = (id: string, title: string, artist: string) => ({ kind: 'song', id, title, subtitle: artist, artists: [{ id: `a${id}`, name: artist }] });

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(h.player, { queue: [], index: 0, isPlaying: false });
});

describe('music tools', () => {
  it('play_music searches and plays the matches, and says what started', async () => {
    h.search.mockResolvedValue([song('1', 'Kun Faya Kun', 'A.R. Rahman'), song('2', 'Khwaja', 'A.R. Rahman')]);
    expect(await runMusicTool('play_music', { query: '  sufi   rahman ' })).toEqual({ ok: true, playing: { title: 'Kun Faya Kun', artist: 'A.R. Rahman' }, upNext: 1 });
    expect(h.search).toHaveBeenCalledWith('sufi rahman', 20);
    expect(h.player.playQueue).toHaveBeenCalledWith(expect.any(Array), 0, { from: expect.objectContaining({ kind: 'search' }) });
  });

  it('play_music: nothing found, no query, or a failing search is an answer, never a throw', async () => {
    h.search.mockResolvedValue([]);
    expect(await runMusicTool('play_music', { query: 'zzzz' })).toMatchObject({ ok: false, found: 0 });
    expect(await runMusicTool('play_music', {})).toMatchObject({ ok: false });
    h.search.mockRejectedValue(new Error('down'));
    expect(await runMusicTool('play_music', { query: 'x' })).toMatchObject({ ok: false });
    expect(h.player.playQueue).not.toHaveBeenCalled();
  });

  it('pause, resume, skip and now playing act on what is loaded', async () => {
    expect(await runMusicTool('pause_music', {})).toMatchObject({ ok: false });
    h.player.queue = [song('1', 'Tum Hi Ho', 'Arijit Singh')];
    h.player.isPlaying = true;
    expect(await runMusicTool('now_playing', {})).toEqual({ ok: true, song: { title: 'Tum Hi Ho', artist: 'Arijit Singh' }, playing: true });
    expect(await runMusicTool('pause_music', {})).toMatchObject({ ok: true });
    expect(h.player.togglePlay).toHaveBeenCalledTimes(1);
    h.player.isPlaying = false;
    expect(await runMusicTool('resume_music', {})).toMatchObject({ ok: true });
    expect(h.player.togglePlay).toHaveBeenCalledTimes(2);
    await runMusicTool('next_song', {});
    expect(h.player.next).toHaveBeenCalledWith(true);
    await runMusicTool('previous_song', {});
    expect(h.player.prev).toHaveBeenCalled();
    expect(await runMusicTool('dance', {})).toMatchObject({ ok: false });
  });

  it('the names match the Worker’s declarations', () => {
    expect([...MUSIC_TOOL_NAMES]).toEqual(['play_music', 'pause_music', 'resume_music', 'next_song', 'previous_song', 'now_playing']);
  });
});
