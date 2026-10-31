// @vitest-environment jsdom
/**
 * The device's side of the AI rerank: what it sends (a compact summary under
 * opaque keys, never a title or an id), that it can only reorder what it sent,
 * that it gives up cleanly at its deadline, and that a "not now" answer pauses
 * it instead of costing every plan its time.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeContext, makeSong, warmProfile } from '@/__fixtures__/songs';

vi.mock('@/services/auth/google', () => ({ currentAccount: () => ({ session: 'session-token' }) }));

import { RERANK_TOP, rerankWithAi, resetMusicAi } from './musicAi';

const songs = Array.from({ length: 50 }, (_, i) => makeSong(`s${i}`, { title: `Secret Title ${i}`, artist: `Singer ${i % 7}`, genre: 'Film' }));
const ctx = () => makeContext({ profile: warmProfile(0), pinnedLanguages: ['telugu'], hour: 21 });
const ok = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;

beforeEach(() => resetMusicAi());
afterEach(() => vi.useRealTimers());

describe('rerankWithAi', () => {
  it('sends only features under opaque keys, never a title or a catalogue id', async () => {
    const fetcher = ok({ order: [] });
    await rerankWithAi(songs, (s) => s, ctx(), { fetcher });
    const [url, init] = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/ai/rerank');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer session-token');
    const body = JSON.parse(String(init.body)) as { candidates: Array<Record<string, unknown>>; taste: Record<string, unknown>; intent: Record<string, unknown> };
    expect(body.candidates).toHaveLength(RERANK_TOP);
    expect(Object.keys(body.candidates[0]).sort()).toEqual(['energy', 'genre', 'key', 'language', 'leadArtist', 'mood']);
    expect(body.candidates.map((c) => c.key)).toEqual(Array.from({ length: RERANK_TOP }, (_, i) => `c${i}`));
    const text = String(init.body);
    expect(text).not.toContain('Secret Title');
    expect(text).not.toContain('"s1"');
    expect(Object.keys(body.taste).sort()).toEqual(['artists', 'discovery', 'energyByHour', 'hour', 'languages', 'moods', 'skipStreak', 'weekday']);
  });

  it('puts the AI’s keys first, keeps the rest in the device’s order, and rejects keys it never sent', async () => {
    const fetcher = ok({ order: [{ key: 'c5', reason: 'Fits your evening' }, { key: 'c999', reason: 'invented' }, { key: 's2', reason: 'a real id, not a key' }, { key: 'c5', reason: 'again' }, { key: 'c1' }] });
    const out = await rerankWithAi(songs, (s) => s, ctx(), { fetcher });
    expect(out.used).toBe(true);
    expect(out.items.slice(0, 4).map((s) => s.id)).toEqual(['s5', 's1', 's0', 's2']);
    expect(out.items).toHaveLength(songs.length);
    expect(new Set(out.items.map((s) => s.id)).size).toBe(songs.length);
    expect([...out.reasons]).toEqual([['s5', 'Fits your evening']]);
  });

  it('keeps the device’s order when the answer names nothing it sent', async () => {
    const out = await rerankWithAi(songs, (s) => s, ctx(), { fetcher: ok({ order: [{ key: 'zz' }] }) });
    expect(out.used).toBe(false);
    expect(out.items).toEqual(songs);
  });

  it('times out cleanly at its deadline: the request is aborted and the order is unchanged', async () => {
    let aborted = false;
    const fetcher = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { aborted = true; reject(new DOMException('aborted', 'AbortError')); });
    })) as unknown as typeof fetch;
    const started = Date.now();
    const out = await rerankWithAi(songs, (s) => s, ctx(), { fetcher, deadlineMs: 120 });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(aborted).toBe(true);
    expect(out.used).toBe(false);
    expect(out.items).toEqual(songs);
  });

  it('pauses after "not configured" so later plans do not wait for it', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: 'ai_not_configured' }), { status: 503 })) as unknown as typeof fetch;
    await rerankWithAi(songs, (s) => s, ctx(), { fetcher });
    await rerankWithAi(songs, (s) => s, ctx(), { fetcher });
    expect((fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it('a network error keeps the order and never throws', async () => {
    const fetcher = vi.fn(async () => { throw new TypeError('offline'); }) as unknown as typeof fetch;
    const out = await rerankWithAi(songs, (s) => s, ctx(), { fetcher });
    expect(out.items).toEqual(songs);
  });
});
