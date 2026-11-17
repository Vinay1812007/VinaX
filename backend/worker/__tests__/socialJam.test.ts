/**
 * v23 — join a friend's jam. A host who switches on "Let people I follow
 * join my room" stores the room's code with their profile; the code goes
 * ONLY to mutual followers and ONLY while the room is live. Against the fake
 * PostgREST.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { issueSession } from '../functions/_lib/googleAuth';
import { JAM_LIVE_MS, jamFor, liveRoomCodes, type ProfileRow } from '../functions/_lib/social';
import * as profile from '../functions/api/profile';
import * as profileHandle from '../functions/api/profile/[handle]';
import * as follow from '../functions/api/follow';
import { DB_ENV, fakeDb } from './helpers/fakeDb';

const AUTH = { GOOGLE_CLIENT_ID: 'x.apps.googleusercontent.com', AUTH_SECRET: 'auth-secret' };
const ENV = { ...AUTH, ...DB_ENV };
let ip = 0;
const req = async (url: string, method: string, body?: unknown, sub: string | null = 'a1'): Promise<Request> =>
  new Request(`https://example.test${url}`, {
    method,
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': `10.79.0.${++ip % 250}`, ...(sub ? { authorization: `Bearer ${await issueSession(ENV, sub)}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

const ACCOUNTS = [{ id: 'a1', name: 'Asha', picture: null }, { id: 'a2', name: 'Bo', picture: null }, { id: 'a3', name: 'Cy', picture: null }];
const iso = (agoMs = 0) => new Date(Date.now() - agoMs).toISOString();
const prof = (account_id: string, handle: string, over: Partial<ProfileRow> = {}): ProfileRow & Record<string, unknown> => ({ account_id, handle, public: true, bio: null, summary: { topArtists: [], topLanguages: [], recentLikes: [] }, now_playing: null, share_now: false, share_jam: false, jam_code: null, updated_at: iso(), ...over });
const room = (code: string, updatedAgoMs = 0) => ({ code, host_token: `tok-${code}`, host_name: 'Bo', current: null, queue: [], requests: [], position: 0, playing: true, created_at: iso(), updated_at: iso(updatedAgoMs) });

afterEach(() => vi.unstubAllGlobals());

describe('jamFor / liveRoomCodes', () => {
  const p = prof('a2', 'bobo', { share_jam: true, jam_code: 'JAM123' });
  it('needs a mutual follower, the switch on and a live room', () => {
    const live = new Set(['JAM123']);
    expect(jamFor(p, true, live)).toBe('JAM123');
    expect(jamFor(p, false, live)).toBeNull();
    expect(jamFor({ ...p, share_jam: false }, true, live)).toBeNull();
    expect(jamFor(p, true, new Set())).toBeNull();
    expect(jamFor({ ...p, jam_code: null }, true, live)).toBeNull();
  });

  it('counts a room live only while its host pushed in the last few minutes, and none on a database failure', async () => {
    const fake = fakeDb({ rooms: [room('LIVE01'), room('IDLE01', JAM_LIVE_MS + 5_000)] });
    expect([...(await liveRoomCodes(ENV, ['LIVE01', 'IDLE01', 'GONE01', null, 'bad code']))]).toEqual(['LIVE01']);
    expect(await liveRoomCodes(ENV, [null, undefined])).toEqual(new Set());
    fake.answer('rooms', () => new Response('{"message":"down"}', { status: 503 }));
    expect(await liveRoomCodes(ENV, ['LIVE01'])).toEqual(new Set());
  });
});

describe('PUT /api/profile — jam', () => {
  it('stores the code only with the switch on and the room\'s own host token, for a live room', async () => {
    const before = iso(10 * 60_000);
    const fake = fakeDb({ accounts: ACCOUNTS, profiles: [prof('a1', 'asha', { updated_at: before, now_playing: { id: 'old' }, share_now: true })], rooms: [room('JAM123'), room('IDLE01', JAM_LIVE_MS + 5_000)] });
    const put = (body: unknown) => req('/api/profile', 'PUT', body).then((request) => profile.onRequestPut({ request, env: ENV }));
    // Switch off: a code is never kept.
    expect((await put({ jam: { code: 'JAM123', hostToken: 'tok-JAM123' } })).status).toBe(200);
    expect(fake.rows('profiles')[0].jam_code).toBeNull();
    // Switch on; the owner sees it.
    const on = await put({ shareJam: true });
    expect(await on.json()).toMatchObject({ profile: { shareJam: true } });
    // Not this listener's room, an unknown room, an idle room, a bad shape.
    expect((await put({ jam: { code: 'JAM123', hostToken: 'guess' } })).status).toBe(403);
    expect((await put({ jam: { code: 'NOPE01', hostToken: 'tok-NOPE01' } })).status).toBe(403);
    expect((await put({ jam: { code: 'IDLE01', hostToken: 'tok-IDLE01' } })).status).toBe(409);
    expect((await put({ jam: { code: '../x', hostToken: 'x' } })).status).toBe(400);
    expect(fake.rows('profiles')[0].jam_code ?? null).toBeNull();
    // The real host: stored, and a jam-only write leaves updated_at alone (an old "now playing" stays old).
    const stamp = fake.rows('profiles')[0].updated_at;
    expect((await put({ jam: { code: 'jam123', hostToken: 'tok-JAM123' } })).status).toBe(200);
    expect(fake.rows('profiles')[0]).toMatchObject({ jam_code: 'JAM123', updated_at: stamp });
    // The room ends: the app clears it. The switch off clears it too.
    await put({ jam: null });
    expect(fake.rows('profiles')[0].jam_code).toBeNull();
    await put({ jam: { code: 'JAM123', hostToken: 'tok-JAM123' } });
    expect(fake.rows('profiles')[0].jam_code).toBe('JAM123');
    await put({ shareJam: false });
    expect(fake.rows('profiles')[0]).toMatchObject({ share_jam: false, jam_code: null });
  });

  it('a room that goes between the check and the write answers ended, not signed out', async () => {
    const fake = fakeDb({ accounts: ACCOUNTS, rooms: [room('JAM123')] });
    const mine = prof('a1', 'asha', { share_jam: true });
    fake.answer('profiles', (call) => call.method === 'GET'
      ? new Response(JSON.stringify([mine]), { status: 200, headers: { 'content-type': 'application/json' } })
      : new Response(JSON.stringify({ code: '23503', message: 'insert or update on table "profiles" violates foreign key constraint "profiles_jam_code_fkey"' }), { status: 409 }));
    const res = await profile.onRequestPut({ request: await req('/api/profile', 'PUT', { jam: { code: 'JAM123', hostToken: 'tok-JAM123' } }), env: ENV });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'ended', field: 'jam' });
  });

  it('a write that never touches the jam sends no jam columns', async () => {
    const fake = fakeDb({ accounts: ACCOUNTS, profiles: [prof('a1', 'asha')] });
    await profile.onRequestPut({ request: await req('/api/profile', 'PUT', { bio: 'hi' }), env: ENV });
    const write = fake.calls.find((c) => c.table === 'profiles' && c.method === 'POST');
    expect(write?.body).not.toHaveProperty('jam_code');
    expect(write?.body).not.toHaveProperty('share_jam');
  });
});

describe('who sees the code', () => {
  // Bo (a2) hosts JAM123 and lets people they follow join. Bo follows Asha
  // (a1) back, but not Cy (a3), who follows Bo one way.
  const seed = (over: Partial<ProfileRow> = {}, roomAgoMs = 0) => fakeDb({
    accounts: ACCOUNTS,
    profiles: [prof('a1', 'asha'), prof('a2', 'bobo', { share_jam: true, jam_code: 'JAM123', ...over }), prof('a3', 'cyan')],
    follows: [{ follower_id: 'a1', followee_id: 'a2' }, { follower_id: 'a2', followee_id: 'a1' }, { follower_id: 'a3', followee_id: 'a2' }],
    rooms: [room('JAM123', roomAgoMs)],
  });
  const list = async (sub: string) => ((await (await follow.onRequestGet({ request: await req('/api/follow', 'GET', undefined, sub), env: ENV })).json()) as { following: Array<Record<string, unknown>> }).following;
  const page = async (sub: string | null) => (await (await profileHandle.onRequestGet({ request: await req('/api/profile/bobo', 'GET', undefined, sub), env: ENV, params: { handle: 'bobo' } })).json()) as { profile: Record<string, unknown> };

  it('a mutual follower gets it in the following list and on the profile page', async () => {
    seed();
    expect(await list('a1')).toMatchObject([{ handle: 'bobo', jamCode: 'JAM123' }]);
    expect((await page('a1')).profile.jamCode).toBe('JAM123');
  });

  it('a one-way follower, a signed-out visitor and the owner never do', async () => {
    seed();
    const cy = await list('a3');
    expect(cy).toHaveLength(1);
    expect(cy[0]).not.toHaveProperty('jamCode');
    expect((await page('a3')).profile).not.toHaveProperty('jamCode');
    expect((await page(null)).profile).not.toHaveProperty('jamCode');
    expect((await page('a2')).profile).not.toHaveProperty('jamCode');
  });

  it('an idle room, an ended room or the switch off shows nothing, even to a mutual follower', async () => {
    seed({}, JAM_LIVE_MS + 5_000);
    expect((await list('a1'))[0]).not.toHaveProperty('jamCode');
    expect((await page('a1')).profile).not.toHaveProperty('jamCode');
    const fake = seed();
    fake.tables.rooms = [];
    expect((await list('a1'))[0]).not.toHaveProperty('jamCode');
    seed({ share_jam: false });
    expect((await list('a1'))[0]).not.toHaveProperty('jamCode');
    expect((await page('a1')).profile).not.toHaveProperty('jamCode');
  });

  it('a private host still shows the code to a mutual follower, and lists people in a jam first', async () => {
    fakeDb({
      accounts: ACCOUNTS,
      profiles: [prof('a2', 'bobo', { public: false, share_jam: true, jam_code: 'JAM123', updated_at: iso(60_000) }), prof('a3', 'cyan', { now_playing: { id: 's1' }, share_now: true })],
      follows: [{ follower_id: 'a1', followee_id: 'a2' }, { follower_id: 'a2', followee_id: 'a1' }, { follower_id: 'a1', followee_id: 'a3' }],
      rooms: [room('JAM123')],
    });
    expect(await list('a1')).toMatchObject([{ handle: 'bobo', jamCode: 'JAM123' }, { handle: 'cyan', nowPlaying: { id: 's1' } }]);
  });
});
