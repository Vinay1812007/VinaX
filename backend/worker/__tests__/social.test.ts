/**
 * 15.0 — the social routes: profiles (own and public), follows, shared
 * playlists (owner writes, collaborator adds through the invite token, public
 * reads), shared chats (create, read by link, expiry) and the room's chat
 * and vote-to-skip. Everything against the fake PostgREST.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { issueSession } from '../functions/_lib/googleAuth';
import * as profile from '../functions/api/profile';
import * as profileHandle from '../functions/api/profile/[handle]';
import * as follow from '../functions/api/follow';
import * as playlist from '../functions/api/shared-playlist';
import * as playlistId from '../functions/api/shared-playlist/[id]';
import * as shareChat from '../functions/api/share-chat';
import * as shareChatId from '../functions/api/share-chat/[id]';
import { onRequestGet as roomGet, onRequestPost as roomPost } from '../functions/api/room';
import { DB_ENV, fakeDb } from './helpers/fakeDb';

const AUTH = { GOOGLE_CLIENT_ID: 'x.apps.googleusercontent.com', AUTH_SECRET: 'auth-secret' };
const ENV = { ...AUTH, ...DB_ENV };
let ip = 0;
const req = async (url: string, method: string, body?: unknown, sub: string | null = 'a1'): Promise<Request> =>
  new Request(`https://example.test${url}`, {
    method,
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': `10.77.0.${++ip % 250}`, ...(sub ? { authorization: `Bearer ${await issueSession(ENV, sub)}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
const ACCOUNTS = [{ id: 'a1', name: 'Asha', picture: 'p1' }, { id: 'a2', name: 'Bo', picture: null }];

afterEach(() => vi.unstubAllGlobals());

describe('/api/profile', () => {
  it('needs a session, is 204 before the first write, then round-trips a cleaned profile', async () => {
    const fake = fakeDb({ accounts: ACCOUNTS });
    expect((await profile.onRequestGet({ request: await req('/api/profile', 'GET', undefined, null), env: ENV })).status).toBe(401);
    expect((await profile.onRequestGet({ request: await req('/api/profile', 'GET'), env: ENV })).status).toBe(204);
    const put = await profile.onRequestPut({ request: await req('/api/profile', 'PUT', { handle: 'Asha_01', public: true, bio: 'x'.repeat(400), summary: { topArtists: [{ name: 'Sid Sriram', plays: 12.4 }, { name: '' }], topLanguages: [{ id: 'telugu', pct: 140 }], recentLikes: [{ id: 's1', title: 'T', subtitle: 'A', image: 'i', junk: 'no' }, { nope: 1 }] }, nowPlaying: { id: 's2', title: 'Now' }, shareNow: true }), env: ENV });
    expect(put.status).toBe(200);
    const body = (await put.json()) as { profile: Record<string, unknown> };
    expect(body.profile).toMatchObject({ handle: 'asha_01', name: 'Asha', public: true, topArtists: [{ name: 'Sid Sriram', plays: 12 }], topLanguages: [{ id: 'telugu', pct: 100 }], nowPlaying: null });
    expect((body.profile.bio as string).length).toBe(160);
    // No music provider: likes and the now-playing song are never stored or shown.
    expect(body.profile.recentLikes).toEqual([]);
    expect(fake.rows('profiles')[0]).toMatchObject({ account_id: 'a1', handle: 'asha_01' });
    expect(JSON.stringify(body.profile)).not.toContain('a1');
  });

  it('rejects a bad handle and a handle another account holds', async () => {
    fakeDb({ accounts: ACCOUNTS, profiles: [{ account_id: 'a2', handle: 'bobo', public: true, bio: null, summary: {}, now_playing: null, share_now: false, updated_at: new Date().toISOString() }] });
    expect((await profile.onRequestPut({ request: await req('/api/profile', 'PUT', { handle: 'A!' }), env: ENV })).status).toBe(400);
    expect((await profile.onRequestPut({ request: await req('/api/profile', 'PUT', { handle: 'BOBO' }), env: ENV })).status).toBe(409);
  });

  it('a public profile is readable by anyone; a private one only to a mutual follower', async () => {
    const now = new Date().toISOString();
    fakeDb({
      accounts: ACCOUNTS,
      profiles: [
        { account_id: 'a1', handle: 'asha', public: true, bio: 'hi', summary: { topArtists: [], topLanguages: [], recentLikes: [] }, now_playing: { id: 's9' }, share_now: true, updated_at: now },
        { account_id: 'a2', handle: 'bobo', public: false, bio: null, summary: {}, now_playing: null, share_now: false, updated_at: now },
      ],
      follows: [{ follower_id: 'a2', followee_id: 'a1' }],
    });
    const anon = await profileHandle.onRequestGet({ request: await req('/api/profile/asha', 'GET', undefined, null), env: ENV, params: { handle: 'asha' } });
    expect(anon.status).toBe(200);
    expect(await anon.json()).toMatchObject({ profile: { handle: 'asha', name: 'Asha', nowPlaying: null, followers: 1 } });
    // Bo is private: Asha does not follow Bo, so Asha cannot see Bo.
    expect((await profileHandle.onRequestGet({ request: await req('/api/profile/bobo', 'GET'), env: ENV, params: { handle: 'bobo' } })).status).toBe(404);
    // Asha follows Bo back → mutual → visible.
    await follow.onRequestPost({ request: await req('/api/follow', 'POST', { handle: 'bobo', on: true }), env: ENV });
    const seen = await profileHandle.onRequestGet({ request: await req('/api/profile/bobo', 'GET'), env: ENV, params: { handle: 'bobo' } });
    expect(seen.status).toBe(200);
    expect(await seen.json()).toMatchObject({ profile: { handle: 'bobo', following: true } });
    expect((await profileHandle.onRequestGet({ request: await req('/api/profile/zzz', 'GET'), env: ENV, params: { handle: 'zzz' } })).status).toBe(404);
  });
});

describe('/api/follow — private profiles', () => {
  it('a private handle answers like a missing one to a stranger, and stays out of their list', async () => {
    const now = new Date().toISOString();
    fakeDb({
      accounts: ACCOUNTS,
      profiles: [{ account_id: 'a2', handle: 'bobo', public: false, bio: 'secret', summary: {}, now_playing: { id: 'x' }, share_now: true, updated_at: now }],
      follows: [{ follower_id: 'a1', followee_id: 'a2' }],
    });
    expect((await follow.onRequestPost({ request: await req('/api/follow', 'POST', { handle: 'bobo', on: true }), env: ENV })).status).toBe(404);
    const list = (await (await follow.onRequestGet({ request: await req('/api/follow', 'GET'), env: ENV })).json()) as { following: unknown[] };
    expect(list.following).toEqual([]);
  });
});

describe('/api/follow', () => {
  it('follows and unfollows by handle, never self, and lists who is listening first', async () => {
    const now = new Date().toISOString();
    const fake = fakeDb({
      accounts: ACCOUNTS,
      profiles: [
        { account_id: 'a1', handle: 'asha', public: true, bio: null, summary: {}, now_playing: null, share_now: false, updated_at: now },
        { account_id: 'a2', handle: 'bobo', public: true, bio: null, summary: { topArtists: [{ name: 'X', plays: 1 }] }, now_playing: { id: 's1', title: 'Live' }, share_now: true, updated_at: now },
      ],
    });
    expect((await follow.onRequestPost({ request: await req('/api/follow', 'POST', { handle: 'asha', on: true }), env: ENV })).status).toBe(409);
    expect((await follow.onRequestPost({ request: await req('/api/follow', 'POST', { handle: 'nobody', on: true }), env: ENV })).status).toBe(404);
    const on = await follow.onRequestPost({ request: await req('/api/follow', 'POST', { handle: 'bobo', on: true }), env: ENV });
    expect(await on.json()).toEqual({ following: true });
    expect(fake.rows('follows')).toMatchObject([{ follower_id: 'a1', followee_id: 'a2' }]);
    const list = await follow.onRequestGet({ request: await req('/api/follow', 'GET'), env: ENV });
    expect(await list.json()).toMatchObject({ following: [{ handle: 'bobo', name: 'Bo', nowPlaying: null, following: true }] });
    await follow.onRequestPost({ request: await req('/api/follow', 'POST', { handle: 'bobo', on: false }), env: ENV });
    expect(fake.rows('follows')).toEqual([]);
    expect(await (await follow.onRequestGet({ request: await req('/api/follow', 'GET'), env: ENV })).json()).toEqual({ following: [] });
  });
});

describe('/api/shared-playlist', () => {
  it('creates with a collab token and no songs (no music provider); a collaborator cannot add one', async () => {
    fakeDb({ accounts: ACCOUNTS });
    const made = await playlist.onRequestPost({ request: await req('/api/shared-playlist', 'POST', { name: 'Road trip', songs: [{ id: 's1', title: 'A', subtitle: 'B', image: 'i' }, { id: 's1', title: 'dup' }], public: false, collab: true }), env: ENV });
    expect(made.status).toBe(200);
    const body = (await made.json()) as { playlist: { id: string; version: number; songs: unknown[]; collab: boolean; public: boolean }; collabToken: string };
    expect(body.playlist).toMatchObject({ name: 'Road trip', version: 1, collab: true, public: false, mine: true, owner: 'Asha' });
    expect(body.playlist.songs).toHaveLength(0);
    expect(body.collabToken).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    const id = body.playlist.id;
    // Private: no token, no session → 404; the token opens it.
    expect((await playlistId.onRequestGet({ request: await req(`/api/shared-playlist/${id}`, 'GET', undefined, null), env: ENV, params: { id } })).status).toBe(404);
    const viaToken = await playlistId.onRequestGet({ request: await req(`/api/shared-playlist/${id}?token=${body.collabToken}`, 'GET', undefined, null), env: ENV, params: { id } });
    expect(viaToken.status).toBe(200);
    expect(await viaToken.json()).toMatchObject({ canEdit: true, playlist: { id } });
    // A collaborator adds a song (no account), wrong token is refused.
    expect((await playlistId.onRequestPost({ request: await req(`/api/shared-playlist/${id}`, 'POST', { token: 'nope', add: { id: 's2', title: 'C' } }, null), env: ENV, params: { id } })).status).toBe(403);
    const added = await playlistId.onRequestPost({ request: await req(`/api/shared-playlist/${id}`, 'POST', { token: body.collabToken, add: { id: 's2', title: 'C' }, by: 'Ravi' }, null), env: ENV, params: { id } });
    expect(added.status).toBe(400);
    // The owner's stale write is a 409 carrying the newer copy; with the current version it lands.
    const stale = await playlist.onRequestPost({ request: await req('/api/shared-playlist', 'POST', { id, name: 'Road trip 2', songs: [], version: 0 }), env: ENV });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ playlist: { version: 1 } });
    const ok = await playlist.onRequestPost({ request: await req('/api/shared-playlist', 'POST', { id, name: 'Road trip 2', songs: [{ id: 's1' }, { id: 's2' }, { id: 's3' }], version: 1, public: true }), env: ENV });
    expect(await ok.json()).toMatchObject({ playlist: { version: 2, public: true, name: 'Road trip 2', songs: [] } });
    // Now public: anyone reads it. Another account cannot write it.
    expect((await playlistId.onRequestGet({ request: await req(`/api/shared-playlist/${id}`, 'GET', undefined, null), env: ENV, params: { id } })).status).toBe(200);
    expect((await playlist.onRequestPost({ request: await req('/api/shared-playlist', 'POST', { id, name: 'Mine now', songs: [], version: 2 }, 'a2'), env: ENV })).status).toBe(403);
    // The owner lists it and deletes it.
    expect(await (await playlist.onRequestGet({ request: await req('/api/shared-playlist', 'GET'), env: ENV })).json()).toMatchObject({ playlists: [{ id }] });
    expect((await playlist.onRequestDelete({ request: await req(`/api/shared-playlist?id=${id}`, 'DELETE'), env: ENV })).status).toBe(204);
    expect((await playlistId.onRequestGet({ request: await req(`/api/shared-playlist/${id}`, 'GET'), env: ENV, params: { id } })).status).toBe(404);
  });

  it('refuses a nameless list and an unsigned write', async () => {
    fakeDb({ accounts: ACCOUNTS });
    expect((await playlist.onRequestPost({ request: await req('/api/shared-playlist', 'POST', { songs: [] }), env: ENV })).status).toBe(400);
    expect((await playlist.onRequestPost({ request: await req('/api/shared-playlist', 'POST', { name: 'x', songs: [] }, null), env: ENV })).status).toBe(401);
  });
});

describe('/api/share-chat', () => {
  it('shares text only, serves it by link, hides it after expiry, and lets the owner delete', async () => {
    const fake = fakeDb({ accounts: ACCOUNTS });
    expect((await shareChat.onRequestPost({ request: await req('/api/share-chat', 'POST', { messages: [] }), env: ENV })).status).toBe(400);
    const made = await shareChat.onRequestPost({ request: await req('/api/share-chat', 'POST', { title: 'Hi', model: 'm', messages: [{ role: 'user', content: 'play something', images: ['data:…'] }, { role: 'assistant', content: 'Sure' }, { role: 'system', content: 'no' }] }), env: ENV });
    expect(made.status).toBe(200);
    const body = (await made.json()) as { id: string; url: string };
    expect(body.url).toBe(`https://example.test/ai/shared/${body.id}`);
    const stored = fake.rows('shared_chats')[0] as { payload: { messages: unknown[] } };
    expect(stored.payload.messages).toEqual([{ role: 'user', content: 'play something' }, { role: 'assistant', content: 'Sure' }]);
    const read = await shareChatId.onRequestGet({ request: await req(`/api/share-chat/${body.id}`, 'GET', undefined, null), env: ENV, params: { id: body.id } });
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ id: body.id, title: 'Hi', model: 'm', messages: [{ role: 'user' }, { role: 'assistant' }] });
    expect(await (await shareChat.onRequestGet({ request: await req('/api/share-chat', 'GET'), env: ENV })).json()).toMatchObject({ chats: [{ id: body.id, title: 'Hi' }] });
    // Expired: gone from readers.
    fake.rows('shared_chats')[0].expires_at = new Date(Date.now() - 1000).toISOString();
    expect((await shareChatId.onRequestGet({ request: await req(`/api/share-chat/${body.id}`, 'GET', undefined, null), env: ENV, params: { id: body.id } })).status).toBe(404);
    expect((await shareChat.onRequestDelete({ request: await req(`/api/share-chat?id=${body.id}`, 'DELETE'), env: ENV })).status).toBe(204);
    expect(fake.rows('shared_chats')).toEqual([]);
  });
});

describe('/api/room — 15.0 chat, names and vote-to-skip', () => {
  const room = (over: Record<string, unknown> = {}) => ({ code: 'ROOM01', host_token: 'host-secret', host_name: 'Asha', current: { id: 's1', title: 'A' }, queue: [], requests: [], position: 0, playing: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), messages: [], skip_votes: [], ...over });
  const post = async (body: unknown) => roomPost({ request: new Request('https://example.test/api/room', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': `10.78.0.${++ip % 250}` }, body: JSON.stringify(body) }), env: ENV });
  const get = async (qs: string) => roomGet({ request: new Request(`https://example.test/api/room?${qs}`, { headers: { 'cf-connecting-ip': `10.78.0.${++ip % 250}` } }), env: ENV });

  it('everyone sees names and the chat; a line is kept, trimmed and capped', async () => {
    const fake = fakeDb({ rooms: [room()], room_members: [{ room_code: 'ROOM01', member_id: 'm1', name: 'Ravi', last_seen: new Date().toISOString() }] });
    expect(await (await post({ action: 'say', code: 'ROOM01', deviceId: 'm2', name: 'Bo', text: '  hello  ' })).json()).toEqual({ ok: true });
    expect((await post({ action: 'say', code: 'ROOM01', deviceId: 'm2', name: 'Bo', text: '   ' })).status).toBe(400);
    const g = await get('code=ROOM01');
    const body = (await g.json()) as { names: string[]; room: { messages: Array<{ by: string; text: string }> } };
    expect(body.names).toContain('Ravi');
    expect(body.names).toContain('Bo');
    expect(body.room.messages).toEqual([{ by: 'Bo', text: 'hello', at: expect.any(String) }]);
    expect(fake.rows('rooms')[0].messages).toHaveLength(1);
  });

  it('counts one skip vote per member for the current song, ignores a stale vote, and a new song clears them', async () => {
    const seen = new Date().toISOString();
    const fake = fakeDb({ rooms: [room()], room_members: ['m1', 'm2', 'm3'].map((m) => ({ room_code: 'ROOM01', member_id: m, name: m, last_seen: seen })) });
    expect((await post({ action: 'skip', code: 'ROOM01', deviceId: 'stranger', songId: 's1' })).status).toBe(403);
    expect(await (await post({ action: 'skip', code: 'ROOM01', deviceId: 'm1', songId: 's1' })).json()).toEqual({ ok: true, skipVotes: 1 });
    expect(await (await post({ action: 'skip', code: 'ROOM01', deviceId: 'm1', songId: 's1' })).json()).toEqual({ ok: true, skipVotes: 1 });
    expect(await (await post({ action: 'skip', code: 'ROOM01', deviceId: 'm2', songId: 's1' })).json()).toEqual({ ok: true, skipVotes: 2 });
    expect(await (await post({ action: 'skip', code: 'ROOM01', deviceId: 'm3', songId: 'old' })).json()).toMatchObject({ ok: true, skipVotes: 2, stale: true });
    expect(((await (await get('code=ROOM01')).json()) as { room: { skipVotes: number } }).room.skipVotes).toBe(2);
    await post({ action: 'update', code: 'ROOM01', hostToken: 'host-secret', song: { id: 's2', title: 'B' }, queue: [], position: 0, playing: true, consumedIds: [] });
    expect(fake.rows('rooms')[0].skip_votes).toEqual([]);
  });
});
