// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';
import { useLibraryStore } from '@/store/libraryStore';
import { useHistoryStore } from '@/store/historyStore';
import { useSettingsStore } from '@/store/settingsStore';
import { getRecommendationContext } from '@/services/recommendation/context';
import { noteSessionEvent, resetSessionIntent } from '@/services/personalization/sessionIntent';
import { addAnchorSeed, anchorLanguages, evenSample, readAnchor, resetAnchor, startAnchor, MAX_START_SEEDS, SESSION_GAP_MS } from './anchor';
import { planNextSongs, poolSize, resetNextUp, setCatalogueApi } from './engine';
import { resetServed } from './memory';
import type { CatalogueApi } from './sources';

const song = (id: string, artist: string, extra: Partial<Song> = {}): Song => ({
  kind: 'song', id, title: `Title ${id}`, subtitle: artist, artists: [{ id: `a-${artist}`, name: artist }], album: null,
  images: [], audio: [{ quality: '320kbps', url: `https://x/${id}.mp4` }], duration: 200, language: 'telugu', year: '2022', explicit: false, hasLyrics: false, playCount: null, ...extra,
});

/** A catalogue that answers from a table and remembers what it was asked. */
function fakeCatalogue(similar: Record<string, Song[]>, top: Record<string, Song[]> = {}) {
  const asked: string[] = [];
  const api: CatalogueApi = {
    similar: async (id) => { asked.push(`similar:${id}`); return similar[id] ?? []; },
    artistTop: async (id) => { asked.push(`top:${id}`); return top[id] ?? []; },
  };
  return { api, asked };
}

const plan = (seed: Song, opts: Parameters<typeof planNextSongs>[2] = {}) => planNextSongs(seed, getRecommendationContext(seed, 'playlist'), { limit: 5, ...opts });

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetAnchor();
  resetNextUp();
  resetServed();
  resetSessionIntent();
  useSettingsStore.setState({ aiDj: false, kidMode: false, mutedLanguages: [], pinnedLanguages: [], queueLanguages: 'mix' });
  useLibraryStore.setState({ favorites: [], hiddenSongIds: [], hiddenArtists: [] });
  useHistoryStore.setState({ entries: [] });
});
afterEach(() => setCatalogueApi(null));

describe('V2 Up Next — the session anchor', () => {
  it('keeps the languages most of the list speaks, and samples a long list end to end', () => {
    const list = [...Array.from({ length: 9 }, (_, i) => song(`t${i}`, `T${i}`)), song('h', 'H', { language: 'hindi' })];
    expect(anchorLanguages(list)).toEqual(['telugu']);
    const half = [song('a', 'A'), song('b', 'B', { language: 'hindi' })];
    expect(anchorLanguages(half).sort()).toEqual(['hindi', 'telugu']);
    const long = Array.from({ length: 300 }, (_, i) => i);
    const sample = evenSample(long, MAX_START_SEEDS);
    expect(sample[0]).toBe(0);
    expect(sample[sample.length - 1]).toBe(299);
    expect(startAnchor(long.map((i) => song(`s${i}`, `A${i}`))).seeds).toHaveLength(MAX_START_SEEDS);
  });

  it('grows with likes; a quiet gap starts a new session, a long playlist does not', () => {
    const now = Date.now();
    const a = startAnchor([song('a', 'A')], now);
    const b = addAnchorSeed(song('liked', 'L'), 'like', now + 1000);
    expect(b?.version).toBe(a.version + 1);
    expect(b?.seeds.map((s) => s.song.id)).toEqual(['a', 'liked']);
    // Two hours later with nothing played: a new session from the song playing.
    expect(readAnchor(song('z', 'Z'), now + 2 * 3_600_000).seeds.map((s) => s.song.id)).toEqual(['z']);
    // Two hours later with plays all along (a long playlist): the same session.
    startAnchor([song('a', 'A')], now);
    expect(readAnchor(song('z', 'Z'), now + 2 * 3_600_000, now + 2 * 3_600_000 - SESSION_GAP_MS / 2).seeds.map((s) => s.song.id)).toEqual(['a']);
  });
});

describe('V2 Up Next — planning', () => {
  it('plans from what the listener chose, never from the automatic pick playing now', async () => {
    const chosen = song('chosen', 'Chosen');
    const { api, asked } = fakeCatalogue({
      chosen: [song('n1', 'N1'), song('n2', 'N2'), song('n3', 'N3'), song('n4', 'N4'), song('n5', 'N5'), song('ta', 'Tamil', { language: 'tamil' })],
      auto: [song('drift', 'Drift', { language: 'hindi' })],
    });
    setCatalogueApi(api);
    startAnchor([chosen]);
    const autoPick = song('auto', 'Auto', { language: 'hindi' });
    const p = await plan(autoPick);
    expect(asked).toContain('similar:chosen');
    expect(asked).not.toContain('similar:auto');
    expect(p.songs.map((s) => s.id).sort()).toEqual(['n1', 'n2', 'n3', 'n4', 'n5']);
    expect(p.language).toBe('telugu');
    expect(p.alg).toMatch(/^nextup-/);
  });

  it('puts the listener’s liked artists first', async () => {
    const liked = song('liked', 'Loved');
    useLibraryStore.setState({ favorites: [liked, song('liked2', 'Loved')] });
    const { api } = fakeCatalogue({ seed: [song('s1', 'Stranger1'), song('s2', 'Stranger2'), song('s3', 'Stranger3')] }, { 'a-Loved': [song('l1', 'Loved')] });
    setCatalogueApi(api);
    startAnchor([song('seed', 'Seed')]);
    const p = await plan(song('seed', 'Seed'));
    // A liked artist's song (or the liked songs themselves) leads the stretch.
    expect(['l1', 'liked', 'liked2']).toContain(p.songs[0].id);
  });

  it('does not repeat what played lately, or an artist the listener just skipped', async () => {
    const now = Date.now();
    useHistoryStore.setState({ entries: [{ song: song('heard', 'H'), ts: now - 3_600_000, completed: true }] });
    noteSessionEvent('skip', song('skipped', 'Skipped Artist'));
    const { api } = fakeCatalogue({ seed: [song('heard', 'H'), song('sk2', 'Skipped Artist'), song('ok1', 'O1'), song('ok2', 'O2')] });
    setCatalogueApi(api);
    startAnchor([song('seed', 'Seed')]);
    const p = await plan(song('seed', 'Seed'));
    const ids = p.songs.map((s) => s.id);
    expect(ids).not.toContain('heard');
    expect(ids).not.toContain('sk2');
    expect(ids).toEqual(expect.arrayContaining(['ok1', 'ok2']));
  });

  it('serves the next stretch from the warm pool without asking the catalogue again', async () => {
    const many = Array.from({ length: 30 }, (_, i) => song(`m${i}`, `Artist ${i}`));
    const { api, asked } = fakeCatalogue({ seed: many });
    setCatalogueApi(api);
    startAnchor([song('seed', 'Seed')]);
    const first = await plan(song('seed', 'Seed'));
    expect(first.songs).toHaveLength(5);
    first.commit(first.songs);
    const askedBefore = asked.length;
    expect(poolSize()).toBeGreaterThan(10);
    const second = await plan(first.songs[4], { excludeIds: first.songs.map((s) => s.id), before: [song('seed', 'Seed'), ...first.songs] });
    expect(second.songs).toHaveLength(5);
    expect(second.songs.some((s) => first.songs.some((f) => f.id === s.id))).toBe(false);
    expect(asked.length).toBe(askedBefore);
    // The served songs are remembered: a fresh session does not offer them again today.
    resetNextUp();
    const again = await plan(song('seed', 'Seed'));
    expect(again.songs.some((s) => first.songs.some((f) => f.id === s.id))).toBe(false);
  });

  it('never stalls: with a silent catalogue it falls back to the listener’s liked songs', async () => {
    vi.useFakeTimers();
    try {
      useLibraryStore.setState({ favorites: [song('f1', 'F1'), song('f2', 'F2'), song('f3', 'F3'), song('ftamil', 'FT', { language: 'tamil' })] });
      setCatalogueApi({ similar: () => new Promise(() => undefined), artistTop: () => new Promise(() => undefined) });
      startAnchor([song('seed', 'Seed')]);
      const pending = plan(song('seed', 'Seed'));
      await vi.advanceTimersByTimeAsync(5_000);
      const p = await pending;
      expect(p.songs.map((s) => s.id).sort()).toEqual(['f1', 'f2', 'f3']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('topUp serves more from the same pool, under the same rules', async () => {
    const many = Array.from({ length: 20 }, (_, i) => song(`m${i}`, `Artist ${i}`));
    setCatalogueApi(fakeCatalogue({ seed: many }).api);
    startAnchor([song('seed', 'Seed')]);
    const p = await plan(song('seed', 'Seed'));
    const more = p.topUp(p.songs[4], 5, { ids: new Set(p.songs.map((s) => s.id)), keys: new Set() });
    expect(more).toHaveLength(5);
    expect(more.some((s) => p.songs.some((x) => x.id === s.id))).toBe(false);
  });
});
