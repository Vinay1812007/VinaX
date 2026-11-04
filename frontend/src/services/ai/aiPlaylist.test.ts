// @vitest-environment jsdom
/**
 * AI Playlist on the device: the AI's picks become catalogue songs, muted
 * languages and last week's plays are left out, and with the AI away (or too
 * few real songs) a catalogue search for the same words takes over.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeContext, makeSong } from '@/__fixtures__/songs';

vi.mock('@/services/auth/google', () => ({ currentAccount: () => ({ session: 'session-token' }) }));

import { makeAiPlaylist, playlistFilter, RECENT_DAYS } from './aiPlaylist';
import { resetMusicAi } from './musicAi';

const songs = Array.from({ length: 8 }, (_, i) => makeSong(`p${i}`, { title: `Melody ${i}`, artist: `Singer ${i}`, language: i === 7 ? 'tamil' : 'telugu' }));
const search = vi.fn(async (q: string) => {
  const m = /^Melody (\d)/.exec(q);
  return m ? [songs[Number(m[1])]] : songs;
});
const ok = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;

beforeEach(() => {
  resetMusicAi();
  search.mockClear();
});

describe('makeAiPlaylist', () => {
  it('resolves the AI’s songs and leaves out muted languages and recent plays', async () => {
    const fetcher = ok({ title: 'Rainy night drive', songs: songs.map((s, i) => ({ title: s.title, artist: `Singer ${i}`, reason: 'Soft' })) });
    const ctx = makeContext({ mutedLanguages: ['tamil'], history: [{ song: songs[0], ts: Date.now() - 86_400_000, completed: true } as never] });
    const out = await makeAiPlaylist('rainy night drive', ctx, { fetcher, search });
    expect(out.source).toBe('ai');
    expect(out.title).toBe('Rainy night drive');
    expect(out.songs.map((s) => s.song.id)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
    const body = JSON.parse(String(((fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit])[1].body)) as { prompt: string; count: number };
    expect(body).toMatchObject({ prompt: 'rainy night drive', count: 20 });
  });

  it('falls back to a catalogue search for the same words when the AI is away', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 503 })) as unknown as typeof fetch;
    const out = await makeAiPlaylist('gym hits', makeContext({ mutedLanguages: ['tamil'] }), { fetcher, search });
    expect(out.source).toBe('search');
    expect(search).toHaveBeenCalledWith('gym hits', 40, undefined);
    expect(out.songs.map((s) => s.song.id)).not.toContain('p7');
    expect(out.title).toBe('Gym hits');
  });

  it('a play older than a week can come back', () => {
    const now = Date.now();
    const keep = playlistFilter(makeContext({ history: [{ song: songs[0], ts: now - (RECENT_DAYS + 1) * 86_400_000, completed: true } as never] }), now);
    expect(keep(songs[0])).toBe(true);
  });
});
