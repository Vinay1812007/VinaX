// @vitest-environment jsdom
/**
 * 1.4 — the AI rerank inside the live planner: its order is used, but the
 * stretch rules (artist spacing) still decide what ships, it can never shorten
 * a stretch, and a plan waits for it only when the listener is not already at
 * the end of the queue.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';

const rerank = vi.fn();
vi.mock('@/services/ai/musicAi', () => ({ rerankWithAi: (...a: unknown[]) => rerank(...a), aiReasonLine: (r: string) => `AI pick · ${r}` }));

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
const pool = [song('a1', 'A'), song('a2', 'A'), song('b1', 'B'), song('c1', 'C'), song('d1', 'D'), song('e1', 'E'), song('f1', 'F')];

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetAnchor();
  resetNextUp();
  resetServed();
  resetSessionIntent();
  rerank.mockReset();
  useSettingsStore.setState({ kidMode: false, mutedLanguages: [], pinnedLanguages: [], queueLanguages: 'mix', aiRerank: true, neverRepeat: false });
  useLibraryStore.setState({ favorites: [], hiddenSongIds: [], hiddenArtists: [] });
  useHistoryStore.setState({ entries: [] });
  setCatalogueApi({ similar: async () => pool, artistTop: async () => [] });
  startAnchor([seed]);
});
afterEach(() => setCatalogueApi(null));

const plan = (opts: Parameters<typeof planNextSongs>[2] = {}) => planNextSongs(seed, getRecommendationContext(seed, 'playlist'), { limit: 5, ...opts });

describe('the AI rerank in Up Next', () => {
  it('follows the AI’s order, and says why in "Why this song?"', async () => {
    rerank.mockImplementation(async (items: Song[]) => ({ items: [items.find((s) => s.id === 'f1')!, ...items.filter((s) => s.id !== 'f1')], reasons: new Map([['f1', 'Lifts the energy']]), used: true }));
    const p = await plan();
    expect(p.songs[0].id).toBe('f1');
    expect(p.relaxed).toContain('ai-rerank');
    p.commit(p.songs);
    expect(useReasonStore.getState().reasons.f1).toBe('AI pick · Lifts the energy');
  });

  it('keeps the spacing rule after the AI: one artist never twice in a row', async () => {
    rerank.mockImplementation(async (items: Song[]) => ({ items: [...items.filter((s) => s.artists[0].name === 'A'), ...items.filter((s) => s.artists[0].name !== 'A')], reasons: new Map(), used: true }));
    const p = await plan();
    for (let i = 1; i < p.songs.length; i += 1) expect(p.songs[i].artists[0].name).not.toBe(p.songs[i - 1].artists[0].name);
  });

  it('plays the on-device order when the AI does not answer', async () => {
    rerank.mockImplementation(async (items: Song[]) => ({ items, reasons: new Map(), used: false }));
    const withAi = await plan();
    resetNextUp();
    useSettingsStore.setState({ aiRerank: false });
    const without = await plan();
    expect(withAi.songs.map((s) => s.id)).toEqual(without.songs.map((s) => s.id));
    expect(withAi.relaxed).not.toContain('ai-rerank');
  });

  it('is skipped while the listener waits at the end of the queue, and when switched off', async () => {
    await plan({ deadlineMs: 3_500 });
    expect(rerank).not.toHaveBeenCalled();
    useSettingsStore.setState({ aiRerank: false });
    await plan();
    expect(rerank).not.toHaveBeenCalled();
  });
});
