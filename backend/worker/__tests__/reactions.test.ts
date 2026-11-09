/**
 * 1.12 — public song reactions: GET counts (with the viewer's own), POST to
 * set, change or take one away, one per device per song; the console's stats.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DB_ENV, fakeDb } from './helpers/fakeDb';
import * as reactions from '../functions/api/reactions';
import * as adminReactions from '../functions/api/admin/reactions';
import { _resetRateLimitsForTests } from '../functions/_lib/ratelimit';

const ENV = { ...DB_ENV, DEVICE_ID_SECRET: 'device-secret-for-tests' };
const TOKEN = 'owner-password-for-tests';
const ADMIN_ENV = { ...ENV, ADMIN_LOGIN_PASSWORD: TOKEN };
/** An owner's console request (the recovery password header). */
const adminGet = (path: string) => ({ request: new Request(`https://admin.vinaxmusic.online${path}`, { headers: { 'x-admin-token': TOKEN, 'cf-connecting-ip': '203.0.113.9' } }), env: ADMIN_ENV });
const DEVICE = 'install-id-0123456789abcdef';
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
const req = (method: string, body?: unknown, path = '/api/reactions') => new Request(`https://www.vinaxmusic.online${path}`, { method, headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7' }, body: body === undefined ? undefined : JSON.stringify(body) });

afterEach(() => { vi.unstubAllGlobals(); _resetRateLimitsForTests(); });

describe('/api/reactions', () => {
  it('answers counts for a song, with the viewer’s own when the device names itself', async () => {
    const fake = fakeDb({});
    fake.answer('rpc/song_reaction_counts', (c) => json({ total: 3, counts: { fire: 2, love: 1 }, mine: (c.body as { p_listener: string | null }).p_listener ? 'fire' : null }));
    const anon = await reactions.onRequestGet({ request: req('GET', undefined, '/api/reactions?song=abc123'), env: ENV });
    expect(anon.status).toBe(200);
    expect(await anon.json()).toEqual({ total: 3, counts: { fire: 2, love: 1 }, mine: null });
    const mine = await reactions.onRequestGet({ request: req('GET', undefined, `/api/reactions?song=abc123&deviceId=${DEVICE}`), env: ENV });
    expect(await mine.json()).toMatchObject({ mine: 'fire' });
    // The raw install id never reaches the database: the derived id does.
    const call = fake.calls.find((c) => c.table === 'rpc/song_reaction_counts' && (c.body as { p_listener: string | null }).p_listener);
    expect((call?.body as { p_listener: string }).p_listener).not.toBe(DEVICE);
    expect((call?.body as { p_listener: string }).p_listener).toMatch(/^[a-z]_[a-f0-9]{16,64}$/);
    expect((await reactions.onRequestGet({ request: req('GET', undefined, '/api/reactions?song=bad%20id'), env: ENV })).status).toBe(400);
  });

  it('sets a reaction (one row per device per song), swaps it, takes it away, and hands a signed id to a new device', async () => {
    const fake = fakeDb({});
    let mine: string | null = null;
    fake.answer('rpc/song_reaction_counts', () => json({ total: mine ? 1 : 0, counts: mine ? { [mine]: 1 } : {}, mine }));
    fake.answer('song_reactions', (c) => {
      if (c.method === 'POST') { mine = (c.body as { emoji: string }).emoji; return json([{}], 201); }
      if (c.method === 'DELETE') { mine = null; return json([], 200); }
      return json([]);
    });
    const set = await reactions.onRequestPost({ request: req('POST', { song: 'abc123', emoji: 'fire', deviceId: DEVICE, title: 'Chuttamalle', artist: 'Anirudh', language: 'Telugu' }), env: ENV });
    expect(set.status).toBe(200);
    const body = (await set.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ total: 1, counts: { fire: 1 }, mine: 'fire' });
    expect(typeof body.signed_device_id_next).toBe('string');
    const row = fake.calls.find((c) => c.table === 'song_reactions' && c.method === 'POST');
    expect(row?.body).toMatchObject({ song_id: 'abc123', emoji: 'fire', song_title: 'Chuttamalle', song_artist: 'Anirudh', language: 'telugu' });
    expect(row?.query).toContain('on_conflict=song_id%2Clistener_id');
    // Another emoji replaces it; the same one again removes it; null removes it too.
    expect(await (await reactions.onRequestPost({ request: req('POST', { song: 'abc123', emoji: 'love', deviceId: DEVICE }), env: ENV })).json()).toMatchObject({ mine: 'love' });
    expect(await (await reactions.onRequestPost({ request: req('POST', { song: 'abc123', emoji: 'love', deviceId: DEVICE }), env: ENV })).json()).toMatchObject({ mine: null, total: 0 });
    expect(fake.calls.filter((c) => c.table === 'song_reactions' && c.method === 'DELETE')).toHaveLength(1);
    expect((await reactions.onRequestPost({ request: req('POST', { song: 'abc123', emoji: 'thumbs', deviceId: DEVICE }), env: ENV })).status).toBe(400);
    expect((await reactions.onRequestPost({ request: req('POST', { emoji: 'fire', deviceId: DEVICE }), env: ENV })).status).toBe(400);
    expect((await reactions.onRequestPost({ request: req('POST', { song: 'abc123', emoji: 'fire' }), env: ENV })).status).toBe(400);
  });

  it('keeps nothing on a Worker without a signing secret', async () => {
    fakeDb({});
    expect((await reactions.onRequestPost({ request: req('POST', { song: 'abc123', emoji: 'fire', deviceId: DEVICE }), env: DB_ENV })).status).toBe(503);
  });
});

describe('/api/admin/reactions', () => {
  it('answers the stats for the range, and says when the database is old', async () => {
    const fake = fakeDb({});
    fake.answer('rpc/stats_reactions', (c) => json({ days: (c.body as { p_days: number }).p_days, total: 5, prevTotal: 2, people: 3, songs: 2, byEmoji: [{ emoji: 'fire', n: 5 }], top: [], byDay: [] }));
    const r = await adminReactions.onRequestGet(adminGet('/api/admin/reactions?days=7&limit=10'));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ configured: true, days: 7, total: 5, byEmoji: [{ emoji: 'fire', n: 5 }] });
    expect(fake.calls.find((c) => c.table === 'rpc/stats_reactions')?.body).toEqual({ p_days: 7, p_limit: 10 });
    fake.answer('rpc/stats_reactions', () => json({ code: 'PGRST202', message: 'Could not find the function' }, 404));
    const old = await adminReactions.onRequestGet(adminGet('/api/admin/reactions'));
    expect(old.status).toBe(502);
    expect(await old.json()).toMatchObject({ error: 'db_update_needed' });
  });
});
