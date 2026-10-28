/**
 * 14.0 — Listen Together rooms on the new database: create answers the code
 * and the host token once, guests poll a count (never names), the host token
 * authorises update and end, a request goes through the atomic function, and
 * without a database both verbs answer 503 not_configured.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequestGet, onRequestOptions, onRequestPost, REACTION_EMOJI } from '../functions/api/room';
import { DB_ENV, fakeDb } from './helpers/fakeDb';

afterEach(() => vi.unstubAllGlobals());

let ip = 0;
const post = (body: unknown, env: object = DB_ENV) =>
  onRequestPost({ request: new Request('https://x.test/api/room', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': `10.88.1.${++ip % 250}` }, body: JSON.stringify(body) }), env });
const get = (qs: string, env: object = DB_ENV) =>
  onRequestGet({ request: new Request(`https://x.test/api/room?${qs}`, { headers: { 'cf-connecting-ip': `10.88.2.${++ip % 250}` } }), env });

describe('/api/room without a database', () => {
  it('answers not_configured for GET and POST, with CORS, and fetches nothing', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const g = await get('code=ABC123', {});
    expect(g.status).toBe(503);
    expect(await g.json()).toEqual({ error: 'not_configured' });
    expect(g.headers.get('access-control-allow-origin')).toBe('*');
    expect((await post({ action: 'create' }, {})).status).toBe(503);
    expect((await onRequestOptions()).status).toBe(204);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('/api/room', () => {
  it('create answers a 6-character code and the host token, and the row never carries the raw song junk', async () => {
    const fake = fakeDb();
    const res = await post({ action: 'create', hostName: 'Vinay', song: { id: 's1', title: 'Orbit', subtitle: 'A', image: 'https://i/x.jpg', evil: { nested: true } } });
    expect(res.status).toBe(200);
    const out = (await res.json()) as { code: string; hostToken: string };
    expect(out.code).toMatch(/^[A-Z0-9]{6}$/);
    expect(out.hostToken.length).toBeGreaterThan(30);
    const row = fake.rows('rooms')[0];
    expect(row.code).toBe(out.code);
    expect(row.host_token).toBe(out.hostToken);
    expect((row.current as { evil?: unknown }).evil).toBeUndefined();
    expect(fake.calls[0].prefer).toContain('ignore-duplicates');
  });

  it('a guest poll gets the room, a member count and reactions but no names or host token; the host gets names', async () => {
    const now = new Date().toISOString();
    const old = new Date(Date.now() - 60_000).toISOString();
    fakeDb({
      rooms: [{ code: 'ABC234', host_token: 'host-secret', host_name: 'Vinay', current: { id: 's1', title: 'Orbit' }, queue: [], requests: [{ song: { id: 's2' }, by: 'Guest' }], position: 12.5, playing: true, updated_at: now }],
      room_members: [
        { room_code: 'ABC234', member_id: 'g1', name: 'Guest One', last_seen: now, reaction: '🔥', reacted_at: now },
        { room_code: 'ABC234', member_id: 'g2', name: 'Gone', last_seen: old, reaction: null, reacted_at: null },
      ],
    });
    const guest = (await (await get('code=abc234')).json()) as Record<string, unknown>;
    expect(guest.room).toEqual({ host_name: 'Vinay', song: { id: 's1', title: 'Orbit' }, queue: [], requests: [{ song: { id: 's2' }, by: 'Guest' }], position: 12.5, playing: true, updated_at: now, messages: [], skipVotes: 0 });
    expect(guest.memberCount).toBe(1);
    expect(guest.reactions).toEqual([{ e: '🔥', at: now }]);
    expect(typeof guest.now).toBe('number');
    expect(guest.members).toBeUndefined();
    expect(JSON.stringify(guest)).not.toContain('host-secret');
    const host = (await (await get('code=ABC234&hostToken=host-secret')).json()) as { members?: string[] };
    expect(host.members).toEqual(['Guest One']);
    const gone = (await (await get('code=ZZZ999')).json()) as { room: unknown; memberCount: number };
    expect(gone.room).toBeNull();
    expect(gone.memberCount).toBe(0);
  });

  it('update and end need the host token; update keeps requests the host did not consume', async () => {
    const fake = fakeDb({ rooms: [{ code: 'ABC234', host_token: 'host-secret', host_name: 'V', current: null, queue: [], requests: [{ song: { id: 's2' }, by: 'G' }, { song: { id: 's3' }, by: 'G' }], position: 0, playing: false, updated_at: 'x' }] });
    expect((await post({ action: 'update', code: 'ABC234', hostToken: 'wrong', song: null })).status).toBe(403);
    expect((await post({ action: 'end', code: 'ABC234' })).status).toBe(403);
    expect((await post({ action: 'update', code: 'NOPE00', hostToken: 'host-secret' })).status).toBe(404);
    const ok = await post({ action: 'update', code: 'ABC234', hostToken: 'host-secret', song: { id: 's9', title: 'Nine' }, queue: [{ song: { id: 'q1' }, by: null }], position: 40, playing: true, consumedIds: ['s2'] });
    expect(await ok.json()).toEqual({ ok: true });
    const row = fake.rows('rooms')[0];
    expect(row.requests).toEqual([{ song: { id: 's3' }, by: 'G' }]);
    expect(row.playing).toBe(true);
    expect((row.current as { id: string }).id).toBe('s9');
    expect(await (await post({ action: 'end', code: 'ABC234', hostToken: 'host-secret' })).json()).toEqual({ ok: true });
    expect(fake.rows('rooms')).toHaveLength(0);
  });

  it('a guest request goes through room_request; a missing room is 404; reactions only from the allowed set', async () => {
    const fake = fakeDb();
    fake.answer('rpc/room_request', (c) => new Response(JSON.stringify((c.body as { p_code: string }).p_code === 'ABC234'), { headers: { 'content-type': 'application/json' } }));
    expect(await (await post({ action: 'request', code: 'ABC234', song: { id: 's5', title: 'Five' }, by: 'G' })).json()).toEqual({ ok: true });
    expect((await post({ action: 'request', code: 'ZZZ999', song: { id: 's5' } })).status).toBe(404);
    expect((await post({ action: 'request', code: 'ABC234', song: { title: 'no id' } })).status).toBe(400);
    expect((await post({ action: 'react', code: 'ABC234', deviceId: 'g1', emoji: '💀' })).status).toBe(400);
    expect(await (await post({ action: 'react', code: 'ABC234', deviceId: 'g1', emoji: REACTION_EMOJI[0], name: 'G' })).json()).toEqual({ ok: true });
    const member = fake.rows('room_members')[0];
    expect(member).toMatchObject({ room_code: 'ABC234', member_id: 'g1', reaction: REACTION_EMOJI[0] });
    expect(await (await post({ action: 'heartbeat', code: 'ABC234', deviceId: 'g1', name: 'G' })).json()).toEqual({ ok: true });
    expect(await (await post({ action: 'leave', code: 'ABC234', deviceId: 'g1' })).json()).toEqual({ ok: true });
    expect(fake.rows('room_members')).toHaveLength(0);
    expect((await post({ action: 'dance', code: 'ABC234' })).status).toBe(400);
  });
});
