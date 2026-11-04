// @vitest-environment jsdom
/**
 * The AI DJ on the device: what it sends, that only catalogue matches come
 * back (never a muted language or the playing song), that it asks once per
 * song and tune, and that it stays silent when switched off.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeContext, makeSong } from '@/__fixtures__/songs';

vi.mock('@/services/auth/google', () => ({ currentAccount: () => ({ session: 'session-token' }) }));

import { aiDjSongs, djReason, resetAiDj, DJ_REUSE_MS } from './dj';
import { resetMusicAi } from './musicAi';

const seed = makeSong('seed', { title: 'Inkem Inkem', artist: 'Sid Sriram', language: 'telugu' });
const hit = makeSong('h1', { title: 'Nee Kallu', artist: 'Anurag Kulkarni', language: 'telugu' });
const tamil = makeSong('t1', { title: 'Kannazhaga', artist: 'Dhanush', language: 'tamil' });
const ok = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
const ANSWER = { songs: [{ title: 'Nee Kallu', artist: 'Anurag Kulkarni', reason: 'Same soft romance' }, { title: 'Kannazhaga', artist: 'Dhanush' }, { title: 'Inkem Inkem', artist: 'Sid Sriram' }, { title: 'Not Real', artist: 'Nobody' }] };
const search = async (q: string) => (q.startsWith('Nee') ? [hit] : q.startsWith('Kannazhaga') ? [tamil] : q.startsWith('Inkem') ? [seed] : []);

beforeEach(() => {
  resetAiDj();
  resetMusicAi();
});

describe('aiDjSongs', () => {
  it('sends the playing song, recent plays, taste and the tune chip, and returns only real matches', async () => {
    const fetcher = ok(ANSWER);
    const ctx = makeContext({ aiDj: true, mutedLanguages: ['tamil'], history: [{ song: hit, ts: Date.now(), completed: true } as never] });
    const songs = await aiDjSongs(seed, ctx, { tune: 'chill', fetcher, search });
    expect(songs.map((s) => s.id)).toEqual(['h1']);
    expect(djReason('h1')).toBe('AI DJ · Same soft romance');
    const [url, init] = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/ai/dj');
    const body = JSON.parse(String(init.body)) as { seed: Record<string, unknown>; recent: unknown[]; intent: { tune: string } };
    expect(body.seed).toMatchObject({ title: 'Inkem Inkem', artist: 'Sid Sriram', language: 'telugu' });
    expect(body.recent).toEqual([{ title: 'Nee Kallu', artist: 'Anurag Kulkarni' }]);
    expect(body.intent.tune).toBe('chill');
  });

  it('asks once per song and tune, and again after DJ_REUSE_MS or for a new tune', async () => {
    const fetcher = ok(ANSWER);
    let t = 1_000;
    const ctx = makeContext({ aiDj: true });
    await aiDjSongs(seed, ctx, { fetcher, search, now: () => t });
    await aiDjSongs(seed, ctx, { fetcher, search, now: () => t });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await aiDjSongs(seed, ctx, { tune: 'classics', fetcher, search, now: () => t });
    expect(fetcher).toHaveBeenCalledTimes(2);
    t += DJ_REUSE_MS + 1;
    await aiDjSongs(seed, ctx, { fetcher, search, now: () => t });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('does nothing when the listener switched the AI DJ off, or the AI fails', async () => {
    const fetcher = ok(ANSWER);
    expect(await aiDjSongs(seed, makeContext({ aiDj: false }), { fetcher, search })).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
    const failing = vi.fn(async () => new Response('{}', { status: 502 })) as unknown as typeof fetch;
    expect(await aiDjSongs(seed, makeContext({ aiDj: true }), { fetcher: failing, search })).toEqual([]);
  });
});
