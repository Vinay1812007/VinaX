// @vitest-environment jsdom
/**
 * The AI DJ inside Up Next: its songs join the warm pool as one source and
 * can lead a stretch with their reason, the stretch rules still apply, and
 * with the DJ off (or silent) the on-device sources fill the queue alone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';

vi.mock('@/services/ai/musicAi', () => ({ rerankWithAi: async (items: Song[]) => ({ items, reasons: new Map(), used: false }), aiReasonLine: (r: string) => r }));
vi.mock('@/services/ai/dj', () => ({ aiDjSongs: async () => [], djReason: (id: string) => (id === 'dj1' ? 'AI DJ · Same mellow mood' : null) }));

import { useLibraryStore } from '@/store/libraryStore';
import { useHistoryStore } from '@/store/historyStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useReasonStore } from '@/store/reasonStore';
import { getRecommendationContext } from '@/services/recommendation/context';
import { resetSessionIntent } from '@/services/personalization/sessionIntent';
import { resetAnchor, startAnchor } from './anchor';
import { planNextSongs, resetNextUp, setCatalogueApi } from './engine';
import { resetServed } from './memory';

const song = (id: string, artist: string): Song => ({
  kind: 'song', id, title: `Title ${id}`, subtitle: artist, artists: [{ id: `a-${artist}`, name: artist }], album: null,
  images: [], audio: [{ quality: '320kbps', url: `https://x/${id}.mp4` }], duration: 200, language: 'telugu', year: '2022', explicit: false, hasLyrics: false, playCount: null,
});
const seed = song('seed', 'S');
const pool = [song('a1', 'A'), song('b1', 'B'), song('c1', 'C'), song('d1', 'D'), song('e1', 'E')];
const djSong = song('dj1', 'DJ Artist');
const aiDj = vi.fn(async () => [djSong]);

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetAnchor();
  resetNextUp();
  resetServed();
  resetSessionIntent();
  aiDj.mockClear();
  useSettingsStore.setState({ kidMode: false, mutedLanguages: [], pinnedLanguages: [], queueLanguages: 'mix', aiRerank: false, aiDjPicks: true, neverRepeat: false });
  useLibraryStore.setState({ favorites: [], hiddenSongIds: [], hiddenArtists: [] });
  useHistoryStore.setState({ entries: [] });
  setCatalogueApi({ similar: async () => pool, artistTop: async () => [], aiDj });
  startAnchor([seed]);
});
afterEach(() => setCatalogueApi(null));

const plan = () => planNextSongs(seed, getRecommendationContext(seed, 'playlist'), { limit: 5, tune: 'chill' });

describe('the AI DJ in Up Next', () => {
  it('adds its songs to the stretch, with the tune passed on and its reason in "Why this song?"', async () => {
    const p = await plan();
    expect(aiDj).toHaveBeenCalled();
    expect(aiDj.mock.calls[0]).toEqual([seed, expect.anything(), expect.objectContaining({ tune: 'chill' })]);
    expect(p.songs.map((s) => s.id)).toContain('dj1');
    p.commit(p.songs);
    expect(useReasonStore.getState().reasons.dj1).toBe('AI DJ · Same mellow mood');
  });

  it('is never asked when the listener switched it off, and the queue still fills', async () => {
    useSettingsStore.setState({ aiDjPicks: false });
    const p = await plan();
    expect(aiDj).not.toHaveBeenCalled();
    expect(p.songs).toHaveLength(5);
    expect(p.songs.map((s) => s.id)).not.toContain('dj1');
  });

  it('a silent AI DJ leaves the on-device stretch as it was', async () => {
    aiDj.mockImplementation(async () => []);
    const p = await plan();
    expect(p.songs).toHaveLength(5);
  });
});
