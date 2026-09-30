/**
 * 8.5.0 — POST /api/ai/playlist: only catalogue ids, never a substitute song,
 * and a catalogue playlist when the AI is unavailable.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogCandidate } from '../../_lib/trends/matcher';

const chatMock = vi.fn();
vi.mock('../../_lib/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../_lib/ai')>();
  return { ...actual, chat: (...args: unknown[]) => chatMock(...args), gather: async () => [], logAiEvent: () => Promise.resolve() };
});
const searchMock = vi.fn(async (_q: string, _n?: number): Promise<CatalogCandidate[]> => []);
let down = false;
vi.mock('../../_lib/trends/catalog', () => {
  class CatalogUnavailable extends Error {}
  return {
    CatalogUnavailable,
    searchCatalogSongs: async (q: string, n?: number) => {
      if (down) throw new CatalogUnavailable('down');
      return searchMock(q, n);
    },
    catalogSongSuggestions: async () => [],
    lookupCatalogSong: async () => null,
  };
});

import { matchesSuggestion, resolveSuggestions } from '../../_lib/playlistResolve';
import { onRequestPost as aiPlaylistPost, type PlaylistTrack } from './playlist';
import { onRequestPost as legacyPlaylistPost } from '../playlist';

const song = (id: string, title: string, artist: string, language = 'telugu', extra: Partial<CatalogCandidate> = {}): CatalogCandidate => ({
  id, title, primaryArtists: [artist], featuredArtists: [], credits: [artist], album: `${title} (Original)`, language, year: 2019, durationSec: 240, ...extra,
});
const KEY = { VINAX_NVD_NEMOTRON_3_5_LIGHTNING_30B_A3B: 'k' };
let ip = 0;
const req = (body: unknown) =>
  new Request('https://vinax.test/api/ai/playlist', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': `10.2.0.${++ip % 250}` }, body: JSON.stringify(body) });
const post = (body: unknown) => aiPlaylistPost({ request: req(body), env: KEY as never });
const aiAnswers = (songs: Array<{ title: string; artist: string; reason?: string }>, name = 'Late Night Drive', description = 'Atmospheric tracks for a night drive.') =>
  chatMock.mockResolvedValue({ content: JSON.stringify({ name, description, songs }), model: 'm', keyRole: 'dj' });

beforeEach(() => {
  chatMock.mockReset();
  searchMock.mockReset();
  searchMock.mockResolvedValue([]);
  down = false;
});

describe('matchesSuggestion', () => {
  it('accepts the song itself, or its decorated title credited to the artist', () => {
    expect(matchesSuggestion(song('a', 'Samajavaragamana', 'Sid Sriram'), 'Samajavaragamana', 'Sid Sriram')).toBe(true);
    expect(matchesSuggestion(song('a', 'Samajavaragamana (From "Ala Vaikunthapurramuloo")', 'Sid Sriram'), 'Samajavaragamana', 'Sid Sriram')).toBe(true);
  });
  it('refuses another song, another artist, and dialogue or BGM cuts', () => {
    expect(matchesSuggestion(song('a', 'Butta Bomma', 'Armaan Malik'), 'Samajavaragamana', 'Sid Sriram')).toBe(false);
    expect(matchesSuggestion(song('a', 'Samajavaragamana', 'Cover Singer'), 'Samajavaragamana', 'Sid Sriram')).toBe(false);
    expect(matchesSuggestion(song('a', 'Samajavaragamana BGM', 'Sid Sriram'), 'Samajavaragamana', 'Sid Sriram')).toBe(false);
  });
});

describe('resolveSuggestions', () => {
  it('drops a suggestion whose search lists only other songs — never the first hit on trust', async () => {
    searchMock.mockImplementation(async (q: string) =>
      q.startsWith('Real Song') ? [song('r00001', 'Real Song', 'Real Artist')] : [song('w00001', 'Some Other Hit', 'Popular Artist')],
    );
    const out = await resolveSuggestions([{ title: 'Real Song', artist: 'Real Artist' }, { title: 'Invented Title', artist: 'Nobody' }]);
    expect(out.map((r) => r.song.id)).toEqual(['r00001']);
  });

  it('folds duplicates and enforces a language the request named', async () => {
    searchMock.mockImplementation(async (q: string) => {
      if (q.startsWith('One')) return [song('o00001', 'One', 'A')];
      if (q.startsWith('Again One')) return [song('o00002', 'One', 'A')];
      if (q.startsWith('Hindi Song')) return [song('h00001', 'Hindi Song', 'H', 'hindi')];
      return [];
    });
    const out = await resolveSuggestions([{ title: 'One', artist: 'A' }, { title: 'Again One', artist: 'A' }, { title: 'Hindi Song', artist: 'H' }], { languages: ['telugu'] });
    expect(out.map((r) => r.song.id)).toEqual(['o00001']);
  });

  it('rethrows only when every catalogue search failed', async () => {
    down = true;
    await expect(resolveSuggestions([{ title: 'X', artist: 'Y' }])).rejects.toThrow();
  });
});

describe('POST /api/ai/playlist', () => {
  it('returns the documented shape with only catalogue ids and the curator\'s per-track reasons', async () => {
    aiAnswers([
      { title: 'Night Road', artist: 'Singer One', reason: 'Matches the late-night, atmospheric mood' },
      { title: 'Made Up Song', artist: 'Nobody Real', reason: 'Would be perfect' },
      ...Array.from({ length: 12 }, (_, i) => ({ title: `Track ${i}`, artist: `Artist ${i}`, reason: 'Slow, moody build' })),
    ]);
    searchMock.mockImplementation(async (q: string) => {
      if (q.startsWith('Night Road')) return [song('n00001', 'Night Road', 'Singer One')];
      const m = /^Track (\d+)/.exec(q);
      if (m) return [song(`t0000${m[1]}`, `Track ${m[1]}`, `Artist ${m[1]}`)];
      return [song('pop001', 'A Famous Different Song', 'Someone')];
    });
    const res = await post({ prompt: 'Make me a playlist for a late-night drive' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { title: string; description: string; tracks: PlaylistTrack[]; source: string; dropped: number };
    expect(body.title).toBe('Late Night Drive');
    expect(body.description).toBe('Atmospheric tracks for a night drive.');
    expect(body.source).toBe('ai');
    expect(body.tracks[0]).toMatchObject({ id: 'n00001', reason: 'Matches the late-night, atmospheric mood', source: 'ai' });
    expect(body.tracks.map((t) => t.id)).not.toContain('pop001');
    expect(body.dropped).toBe(1);
    expect(body.tracks).toHaveLength(13);
  });

  it('tops up a short list with catalogue songs for the request, labelled as such', async () => {
    aiAnswers([{ title: 'Only One', artist: 'Singer', reason: 'Energetic opener' }]);
    searchMock.mockImplementation(async (q: string) => {
      if (q.startsWith('Only One')) return [song('only01', 'Only One', 'Singer', 'hindi')];
      if (q === 'hindi dance songs') return [song('gym001', 'Gym Beat', 'G1', 'hindi'), song('gym002', 'Lift', 'G2', 'hindi')];
      return [];
    });
    const body = (await (await post({ prompt: 'Give me energetic Hindi songs for the gym' })).json()) as { tracks: PlaylistTrack[]; source: string };
    expect(body.source).toBe('ai');
    expect(body.tracks.map((t) => [t.id, t.source])).toEqual([['only01', 'ai'], ['gym001', 'catalogue'], ['gym002', 'catalogue']]);
    expect(body.tracks[1].reason).toMatch(/^Matches Hindi/);
  });

  it('answers with a catalogue playlist when the AI is not configured', async () => {
    chatMock.mockResolvedValue({ content: null, model: null, error: 'not_configured' });
    searchMock.mockImplementation(async (q: string) => (q === 'instrumental' || q.endsWith('instrumental') ? [song('ins001', 'Theme (Instrumental)', 'Composer', 'hindi')] : []));
    const res = await aiPlaylistPost({ request: req({ prompt: 'Relaxing instrumental music for studying' }), env: {} as never });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { title: string; tracks: PlaylistTrack[]; source: string };
    expect(body.source).toBe('catalogue');
    expect(body.title).toBe('Focus Mix');
    expect(body.tracks.map((t) => t.id)).toEqual(['ins001']);
  });

  it('keeps 400/413 answers, validates limit, and answers 502 when the catalogue is down', async () => {
    expect((await post({})).status).toBe(400);
    expect((await post({ prompt: 'x', limit: 5 })).status).toBe(400);
    expect((await post({ prompt: 'x', limit: 'many' })).status).toBe(400);
    aiAnswers([{ title: 'A', artist: 'B' }]);
    down = true;
    const res = await post({ prompt: 'telugu melodies' });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'catalogue_unavailable' });
  });
});

describe('/api/playlist (installed app builds) is unchanged', () => {
  it('still answers titles and artists, now with an optional reason', async () => {
    aiAnswers([{ title: 'Song A', artist: 'Artist A', reason: 'fits' }, { title: 'Song B', artist: 'Artist B' }]);
    const res = await legacyPlaylistPost({ request: new Request('https://vinax.test/api/playlist', { method: 'POST', headers: { 'cf-connecting-ip': '10.3.0.1' }, body: JSON.stringify({ prompt: 'telugu melodies' }) }), env: KEY as never });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string; songs: Array<Record<string, unknown>> };
    expect(body.name).toBe('Late Night Drive');
    expect(body.songs).toEqual([{ title: 'Song A', artist: 'Artist A', reason: 'fits' }, { title: 'Song B', artist: 'Artist B' }]);
  });
});
