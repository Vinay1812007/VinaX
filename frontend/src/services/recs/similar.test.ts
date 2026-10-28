// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';

const getSong = vi.fn();
const getSongSuggestions = vi.fn();
vi.mock('@/services/api', () => ({ getSong: (...a: unknown[]) => getSong(...a), getSongSuggestions: (...a: unknown[]) => getSongSuggestions(...a) }));
vi.mock('@/services/native', () => ({ isNativePlatform: () => false }));

const song = (id: string, title = id): Song =>
  ({ kind: 'song', id, title, subtitle: 'A', artists: [{ id: 'a', name: 'A' }], album: { id: 'al', name: 'Al' }, images: [], audio: [], duration: 1, language: 'telugu', year: '2020', explicit: false, hasLyrics: false, playCount: 0 }) as unknown as Song;

describe('15.0 — songs like this', () => {
  beforeEach(() => {
    getSong.mockReset();
    getSongSuggestions.mockReset();
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('resolves the ranked route to playable songs and keeps each reason', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ tracks: [{ id: 'b', title: 'B', artist: 'A', reason: 'same_artist', reasonText: 'Same artist as A', seedId: 'a' }, { id: 'gone', title: 'G', artist: 'A', reason: 'similar', reasonText: 'x', seedId: 'a' }] }) });
    getSong.mockImplementation(async (id: string) => { if (id === 'gone') throw new Error('404'); return song(id); });
    const { songsLikeThis } = await import('./similar');
    const { useReasonStore } = await import('@/store/reasonStore');
    const out = await songsLikeThis(song('a'), { limit: 5, languages: ['telugu'] });
    expect(out.map((s) => s.id)).toEqual(['b']);
    expect(useReasonStore.getState().reasons.b).toBe('Same artist as A');
    const url = String((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(url).toContain('/api/recommendations/similar/a?limit=5');
    expect(url).toContain('languages=telugu');
  });

  it('falls back to the catalogue suggestions when the route fails, never throwing', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    getSongSuggestions.mockResolvedValue([song('a'), song('c'), song('d')]);
    const { songsLikeThis } = await import('./similar');
    const out = await songsLikeThis(song('a'), { limit: 5 });
    expect(out.map((s) => s.id)).toEqual(['c', 'd']);
    getSongSuggestions.mockRejectedValue(new Error('offline'));
    expect(await songsLikeThis(song('a'))).toEqual([]);
  });

  it('seeded recommendations leave out the seeds and the exclusions', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ tracks: [{ id: 'a', title: 'A', artist: 'A', reason: 'similar', reasonText: 'r', seedId: 'a' }, { id: 'z', title: 'Z', artist: 'A', reason: 'similar', reasonText: 'r', seedId: 'a' }, { id: 'n', title: 'N', artist: 'A', reason: 'similar', reasonText: 'Because you played A', seedId: 'a' }] }) });
    getSong.mockImplementation(async (id: string) => song(id));
    const { recommendFromSeeds } = await import('./similar');
    const out = await recommendFromSeeds([song('a')], { exclude: ['z'], limit: 5 });
    expect(out.map((s) => s.id)).toEqual(['n']);
    const url = String((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(url).toContain('/api/recommendations?seeds=a&limit=5');
    expect(url).toContain('exclude=');
  });
});
