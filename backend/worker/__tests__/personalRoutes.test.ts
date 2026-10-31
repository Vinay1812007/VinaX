/**
 * /api/personal/* against the fake database: the gates (session, database,
 * the owner's switch), the event batch (caps, cleaning, idempotence through
 * the recording function, the model written with its version), the Home
 * page (204 for an empty model, a page from a pool, the saved page served
 * again), recommend, the playlist builder's checks, and erase.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { issueSession } from '../functions/_lib/googleAuth';
import { resetSettingsMemo } from '../functions/_lib/settings';
import { _resetRateLimitsForTests } from '../functions/_lib/ratelimit';
import * as events from '../functions/api/personal/events';
import * as home from '../functions/api/personal/home';
import * as recommend from '../functions/api/personal/recommend';
import * as playlist from '../functions/api/personal/playlist';
import * as taste from '../functions/api/personal/taste';
import { DB_ENV, fakeDb, type FakeDb } from './helpers/fakeDb';

const AUTH = { GOOGLE_CLIENT_ID: 'x.apps.googleusercontent.com', AUTH_SECRET: 'auth-secret' };
const ENV = { ...AUTH, ...DB_ENV };
const SUB = '1001';

let ip = 0;
async function req(path: string, init: { method?: string; body?: unknown; session?: string | null } = {}): Promise<Request> {
  const session = init.session === null ? null : init.session ?? (await issueSession(ENV, SUB));
  return new Request(`https://example.test${path}`, {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': `10.77.0.${++ip % 250}`, ...(session ? { authorization: `Bearer ${session}` } : {}) },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });
}

const song = (id: string, over: Record<string, unknown> = {}) => ({
  id, title: `Song ${id}`, artist: 'Sid Sriram', artistId: 'ar1', artists: [{ id: 'ar1', name: 'Sid Sriram' }], album: 'Album', albumId: 'al1',
  language: 'telugu', year: 2024, duration: 240, image: 'https://img.example/a.jpg', facets: { mood: 'romantic' }, ...over,
});
const row = (id: string, over: Record<string, unknown> = {}) => ({
  id, title: `Song ${id}`, artist: 'Sid Sriram', artist_id: 'ar1', artists: [{ id: 'ar1', name: 'Sid Sriram' }], album: 'Album', album_id: 'al1', language: 'telugu',
  year: 2024, duration: 240, image: null, key: `song ${id}|sid sriram`, facets: {}, embed_model: 'm', embedded_at: null, plays: 3, completes: 1, skips: 0, likes: 0, verified: true,
  first_seen: '2026-10-01T00:00:00.000Z', last_seen: '2026-10-30T00:00:00.000Z', ...over,
});

const jsonRes = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

/** The database functions as the database does them: new client ids are inserted (and kept as rows), repeats skipped; touched songs land in the table without rewriting known rows. */
function recordingRpc(fake: FakeDb, o: { failFold?: boolean } = {}) {
  const seen = new Set<string>();
  fake.answer('rpc/personal_record_events', (call) => {
    const body = call.body as { p_account: string; p_events: Array<{ id: string; kind: string; songId: string }> };
    const inserted = body.p_events.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
    for (const e of inserted) fake.rows('personal_events').push({ account_id: body.p_account, client_id: e.id, kind: e.kind, song_id: e.songId });
    return jsonRes({ inserted: inserted.map((e) => e.id) });
  });
  fake.answer('rpc/personal_touch_songs', (call) => {
    const body = call.body as { p_rows: Array<Record<string, unknown>>; p_verified: boolean };
    let n = 0;
    for (const r of body.p_rows) {
      const existing = fake.rows('personal_songs').find((x) => x.id === r.id);
      if (existing) { if (body.p_verified) Object.assign(existing, { title: r.title, verified: true }); continue; }
      n += 1;
      fake.rows('personal_songs').push({ id: r.id, title: r.title, artist: r.artist, artist_id: r.artistId, artists: r.artists, album: r.album, album_id: r.albumId, language: r.language, year: r.year, duration: r.duration, image: r.image, key: r.key, facets: r.facets, embed_model: null, embedded_at: null, plays: 0, completes: 0, skips: 0, likes: 0, verified: body.p_verified, first_seen: new Date().toISOString(), last_seen: new Date().toISOString() });
    }
    return jsonRes(n);
  });
  fake.answer('rpc/personal_exposure_for', (call) => {
    const body = call.body as { p_account: string; p_songs: string[] };
    return jsonRes(fake.rows('personal_exposure').filter((x) => x.account_id === body.p_account && body.p_songs.includes(String(x.song_id))));
  });
  if (o.failFold) fake.answer('personal_taste', () => new Response('{"message":"down"}', { status: 503, headers: { 'content-type': 'application/json' } }));
}

const waits: Promise<unknown>[] = [];
const waitUntil = (p: Promise<unknown>) => { waits.push(p); };

beforeEach(() => { resetSettingsMemo(); _resetRateLimitsForTests(); waits.length = 0; });
afterEach(() => vi.unstubAllGlobals());

describe('the gates', () => {
  it('every route needs a session', async () => {
    fakeDb();
    expect((await events.onRequestPost({ request: await req('/api/personal/events', { method: 'POST', body: { events: [] }, session: null }), env: ENV })).status).toBe(401);
    expect((await home.onRequestGet({ request: await req('/api/personal/home', { session: 'vx1.forged.sig' }), env: ENV })).status).toBe(401);
    expect((await recommend.onRequestGet({ request: await req('/api/personal/recommend', { session: null }), env: ENV })).status).toBe(401);
    expect((await playlist.onRequestPost({ request: await req('/api/personal/playlist', { method: 'POST', body: { prompt: 'x' }, session: null }), env: ENV })).status).toBe(401);
    expect((await taste.onRequestGet({ request: await req('/api/personal/taste', { session: null }), env: ENV })).status).toBe(401);
    expect((await taste.onRequestDelete({ request: await req('/api/personal/taste', { method: 'DELETE', session: null }), env: ENV })).status).toBe(401);
  });

  it('without a database everything is 503 unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn());
    expect((await home.onRequestGet({ request: await req('/api/personal/home'), env: AUTH as never })).status).toBe(503);
    expect((await taste.onRequestGet({ request: await req('/api/personal/taste'), env: AUTH as never })).status).toBe(503);
  });

  it('the owner can switch the engine off; erase still works', async () => {
    const fake = fakeDb({ settings: [{ key: 'personal-config', value: { enabled: false } }] });
    fake.answer('rpc/personal_erase', () => new Response(JSON.stringify({ events: 0, exposure: 0, pages: 0, taste: 0 }), { headers: { 'content-type': 'application/json' } }));
    const res = await home.onRequestGet({ request: await req('/api/personal/home'), env: ENV });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'personal_disabled' });
    expect((await taste.onRequestDelete({ request: await req('/api/personal/taste', { method: 'DELETE' }), env: ENV })).status).toBe(200);
  });

  it('answers OPTIONS for the app shell on another origin', async () => {
    const res = await events.onRequestOptions();
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS');
  });
});

describe('POST /api/personal/events', () => {
  it('writes the songs, records the events once, folds the model and recomputes the vector in the background', async () => {
    const fake = fakeDb();
    recordingRpc(fake);
    const at = Date.now() - 1000;
    const body = {
      events: [
        { id: 'ev-1', kind: 'play', at, songId: 's1', heardSec: 120, durationSec: 240, source: 'home:made-for-you', context: { hour: 21, dow: 6, shelf: 'made-for-you', position: 2 } },
        { id: 'ev-2', kind: 'like', at, songId: 's1' },
        { id: 'ev-3', kind: 'teleport', at, songId: 's1' },
        { id: 'ev-4', kind: 'skip', at, songId: 'not a song id!' },
      ],
      songs: [song('s1'), song('s9')],
      mode: 'discover',
    };
    const res = await events.onRequestPost({ request: await req('/api/personal/events', { method: 'POST', body }), env: ENV, waitUntil });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accepted: 2, duplicates: 0, version: 2, dropped: 2 });
    // the song that no event named is not written; the device's row starts unverified
    expect(fake.rows('personal_songs').map((r) => r.id)).toEqual(['s1']);
    expect(fake.rows('personal_songs')[0]).toMatchObject({ key: 'songs1|sidsriram', language: 'telugu', facets: { mood: 'romantic' }, verified: false });
    const touched = fake.calls.find((c) => c.table === 'rpc/personal_touch_songs')!.body as { p_verified: boolean };
    expect(touched.p_verified).toBe(false);
    const recorded = fake.calls.find((c) => c.table === 'rpc/personal_record_events')!.body as { p_account: string; p_events: Array<Record<string, unknown>> };
    expect(recorded.p_account).toBe(SUB);
    expect(recorded.p_events.map((e) => e.id)).toEqual(['ev-1', 'ev-2']);
    expect(recorded.p_events[0]).toMatchObject({ kind: 'play', songId: 's1', heardSec: 120, source: 'home:made-for-you', context: { hour: 21, shelf: 'made-for-you', position: 2 } });
    const model = fake.rows('personal_taste')[0] as { version: number; songs: Record<string, { score: number }>; mode: string; events_seen: number; hours: Record<string, number[]> };
    expect(model.version).toBe(2);
    expect(model.mode).toBe('discover');
    expect(model.events_seen).toBe(2);
    expect(model.songs.s1.score).toBeCloseTo(4);
    expect(model.hours._all[21]).toBe(1);
    await Promise.all(waits);
    expect(fake.calls.some((c) => c.table === 'rpc/personal_recompute_vector')).toBe(true);
  });

  it('a retried batch counts nothing twice', async () => {
    const fake = fakeDb();
    recordingRpc(fake);
    const body = { events: [{ id: 'ev-1', kind: 'play', at: Date.now(), songId: 's1' }], songs: [song('s1')] };
    await events.onRequestPost({ request: await req('/api/personal/events', { method: 'POST', body }), env: ENV, waitUntil });
    const again = await events.onRequestPost({ request: await req('/api/personal/events', { method: 'POST', body }), env: ENV, waitUntil });
    expect(await again.json()).toEqual({ accepted: 0, duplicates: 1, version: null, dropped: 0 });
    expect((fake.rows('personal_taste')[0] as { version: number }).version).toBe(2);
  });

  it('a second batch folds into the stored model with the next version', async () => {
    const fake = fakeDb();
    recordingRpc(fake);
    await events.onRequestPost({ request: await req('/api/personal/events', { method: 'POST', body: { events: [{ id: 'ev-a', kind: 'play', at: Date.now(), songId: 's1' }], songs: [song('s1')] } }), env: ENV, waitUntil });
    const res = await events.onRequestPost({ request: await req('/api/personal/events', { method: 'POST', body: { events: [{ id: 'ev-b', kind: 'complete', at: Date.now(), songId: 's1' }], songs: [song('s1')] } }), env: ENV, waitUntil });
    expect(await res.json()).toMatchObject({ accepted: 1, version: 3 });
    const model = fake.rows('personal_taste')[0] as { version: number; songs: Record<string, { score: number; plays: number; completes: number }> };
    expect(model.version).toBe(3);
    expect(model.songs.s1).toMatchObject({ plays: 1, completes: 1 });
    expect(model.songs.s1.score).toBeCloseTo(3);
  });

  it('takes the events back out when the fold cannot be saved, so the retry counts them', async () => {
    const fake = fakeDb();
    recordingRpc(fake, { failFold: true });
    const body = { events: [{ id: 'ev-1', kind: 'play', at: Date.now(), songId: 's1' }], songs: [song('s1')] };
    const res = await events.onRequestPost({ request: await req('/api/personal/events', { method: 'POST', body }), env: ENV, waitUntil });
    expect(res.status).toBe(503);
    const removal = fake.calls.find((c) => c.method === 'DELETE' && c.table === 'personal_events');
    expect(removal?.query).toContain('client_id=in.');
    expect(removal?.query).toContain('ev-1');
  });

  it('a batch with nothing new and the same mode does not touch the model', async () => {
    const fake = fakeDb();
    recordingRpc(fake);
    const body = { events: [{ id: 'ev-1', kind: 'play', at: Date.now(), songId: 's1' }], songs: [song('s1')], mode: 'balanced' };
    await events.onRequestPost({ request: await req('/api/personal/events', { method: 'POST', body }), env: ENV, waitUntil });
    const before = fake.calls.length;
    const again = await events.onRequestPost({ request: await req('/api/personal/events', { method: 'POST', body }), env: ENV, waitUntil });
    expect(await again.json()).toMatchObject({ accepted: 0, duplicates: 1, version: null });
    expect(fake.calls.slice(before).some((c) => c.method === 'PATCH' && c.table === 'personal_taste')).toBe(false);
  });

  it('refuses a body over 64 KB and ignores an empty batch', async () => {
    fakeDb();
    const big = { events: [], songs: [], pad: 'x'.repeat(70_000) };
    expect((await events.onRequestPost({ request: await req('/api/personal/events', { method: 'POST', body: big }), env: ENV })).status).toBe(413);
    const empty = await events.onRequestPost({ request: await req('/api/personal/events', { method: 'POST', body: { events: [] } }), env: ENV });
    expect(await empty.json()).toEqual({ accepted: 0, duplicates: 0, version: null, dropped: 0 });
  });
});

describe('GET /api/personal/home', () => {
  const tasteRow = (over: Record<string, unknown> = {}) => ({
    account_id: SUB, embed_model: 'm', artists: { ar1: { name: 'Sid Sriram', score: 12, plays: 6, completes: 3, skips: 0, last: Date.now() } },
    languages: { telugu: { score: 12, plays: 6, completes: 3, skips: 0, last: Date.now() } }, facets: { moods: {}, genres: {}, decades: {}, energy: { sum: 0, n: 0 } },
    hours: {}, songs: { seed: { score: 9, plays: 3, completes: 2, skips: 0, likes: 1, last: Date.now() } }, summary: { lines: [] }, mode: 'balanced', events_seen: 6, version: 4, updated_at: new Date().toISOString(), ...over,
  });

  it('is 204 while the model knows too little for a page', async () => {
    fakeDb();
    const res = await home.onRequestGet({ request: await req('/api/personal/home?hour=21&dow=6'), env: ENV, waitUntil });
    expect(res.status).toBe(204);
  });

  it('builds a page from the pool, saves it, and serves the saved page next time', async () => {
    const pool = Array.from({ length: 30 }, (_, i) => row(`n${i}`, { artist: `Artist ${i % 8}`, artist_id: `ar${i % 8}`, key: `song n${i}|artist ${i % 8}`, language: i % 3 ? 'telugu' : 'hindi' }));
    const fake = fakeDb({ personal_taste: [tasteRow()], personal_songs: [...pool, row('seed')], accounts: [{ id: SUB, name: 'Asha Rao' }] });
    recordingRpc(fake);
    fake.answer('rpc/personal_neighbours', () => new Response(JSON.stringify(pool.map((p, i) => ({ id: p.id, similarity: 0.9 - i * 0.01, language: p.language, artist_id: p.artist_id }))), { headers: { 'content-type': 'application/json' } }));
    fake.answer('rpc/personal_trending', () => new Response(JSON.stringify(pool.slice(0, 10).map((p, i) => ({ id: p.id, plays: 100 - i }))), { headers: { 'content-type': 'application/json' } }));
    const res = await home.onRequestGet({ request: await req('/api/personal/home?hour=21&dow=6&mode=balanced'), env: ENV, waitUntil });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const page = (await res.json()) as { shelves: Array<{ key: string; title: string; reason: string; songs: Array<{ id: string; title: string; artist: string; reason?: string }> }>; model: string | null; cached: boolean; tasteVersion: number; greeting: string | null };
    expect(page.cached).toBe(false);
    expect(page.model).toBeNull();
    expect(page.tasteVersion).toBe(4);
    expect(page.shelves[0].key).toBe('made-for-you');
    expect(page.shelves[0].songs.length).toBeGreaterThanOrEqual(6);
    expect(page.shelves[0].songs[0]).toMatchObject({ title: expect.any(String), artist: expect.any(String) });
    const all = page.shelves.flatMap((s) => s.songs.map((x) => x.id));
    expect(new Set(all).size).toBe(all.length);
    await Promise.all(waits);
    const saved = fake.rows('personal_pages');
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ account_id: SUB, kind: 'home', composed: false, taste_version: 4, events_seen: 6 });
    const shown = fake.calls.find((c) => c.table === 'rpc/personal_mark_shown')!.body as { p_account: string; p_songs: string[] };
    expect(shown.p_account).toBe(SUB);
    expect(new Set(shown.p_songs)).toEqual(new Set(all));

    const callsBefore = fake.calls.length;
    const again = await home.onRequestGet({ request: await req('/api/personal/home?hour=22'), env: ENV, waitUntil });
    const cached = (await again.json()) as { cached: boolean; shelves: unknown[] };
    expect(cached.cached).toBe(true);
    expect(cached.shelves).toHaveLength(page.shelves.length);
    expect(fake.calls.slice(callsBefore).some((c) => c.table === 'rpc/personal_neighbours')).toBe(false);

    const fresh = await home.onRequestGet({ request: await req('/api/personal/home?fresh=1'), env: ENV, waitUntil });
    expect(((await fresh.json()) as { cached: boolean }).cached).toBe(false);

    // the saved page goes stale once the model took in 30 more events
    (fake.rows('personal_taste')[0] as { events_seen: number }).events_seen = 6 + 30;
    const stale = await home.onRequestGet({ request: await req('/api/personal/home'), env: ENV, waitUntil });
    expect(((await stale.json()) as { cached: boolean }).cached).toBe(false);
  });

  it('never shows a song the catalogue has not confirmed', async () => {
    const pool = Array.from({ length: 12 }, (_, i) => row(`n${i}`, { artist: `Artist ${i}`, artist_id: `ar${i}`, key: `song n${i}|artist ${i}`, verified: i % 2 === 0 }));
    const fake = fakeDb({ personal_taste: [tasteRow()], personal_songs: pool });
    recordingRpc(fake);
    fake.answer('rpc/personal_neighbours', () => jsonRes(pool.map((p, i) => ({ id: p.id, similarity: 0.9 - i * 0.01, language: p.language, artist_id: p.artist_id }))));
    const res = await home.onRequestGet({ request: await req('/api/personal/home?hour=21'), env: ENV, waitUntil });
    expect(res.status).toBe(200);
    const page = (await res.json()) as { shelves: Array<{ songs: Array<{ id: string }> }> };
    const shown = page.shelves.flatMap((s) => s.songs.map((x) => x.id));
    expect(shown.length).toBeGreaterThan(0);
    for (const id of shown) expect(Number(id.slice(1)) % 2).toBe(0);
  });
});

describe('GET /api/personal/recommend', () => {
  it('ranks around a seed and leaves the seed and the excluded out', async () => {
    const pool = Array.from({ length: 12 }, (_, i) => row(`r${i}`, { artist: `A${i % 5}`, artist_id: `a${i % 5}`, key: `r${i}|a${i % 5}` }));
    const fake = fakeDb({ personal_songs: [...pool, row('seed')] });
    recordingRpc(fake);
    fake.answer('rpc/personal_similar_songs', () => new Response(JSON.stringify(pool.map((p, i) => ({ id: p.id, similarity: 0.8 - i * 0.02 }))), { headers: { 'content-type': 'application/json' } }));
    const res = await recommend.onRequestGet({ request: await req('/api/personal/recommend?seed=seed&limit=5&exclude=r0,r1'), env: ENV, waitUntil });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { seed: string; songs: Array<{ id: string }> };
    expect(body.seed).toBe('seed');
    expect(body.songs).toHaveLength(5);
    expect(body.songs.map((s) => s.id)).toEqual(expect.not.arrayContaining(['seed', 'r0', 'r1']));
  });
});

describe('POST /api/personal/playlist', () => {
  it('needs a prompt of 3 to 500 characters', async () => {
    fakeDb();
    expect((await playlist.onRequestPost({ request: await req('/api/personal/playlist', { method: 'POST', body: { prompt: 'hi' } }), env: ENV })).status).toBe(400);
    expect((await playlist.onRequestPost({ request: await req('/api/personal/playlist', { method: 'POST', body: { prompt: 'x'.repeat(501) } }), env: ENV })).status).toBe(400);
  });
  it('is 422 when nothing fits, and GET needs a real id', async () => {
    fakeDb();
    const res = await playlist.onRequestPost({ request: await req('/api/personal/playlist', { method: 'POST', body: { prompt: 'songs for a rainy evening' } }), env: ENV, waitUntil });
    expect(res.status).toBe(422);
    expect((await playlist.onRequestGet({ request: await req('/api/personal/playlist?id=nope'), env: ENV })).status).toBe(400);
    expect((await playlist.onRequestGet({ request: await req('/api/personal/playlist?id=00000000-0000-4000-8000-000000000001'), env: ENV })).status).toBe(404);
  });
  it('builds from search results when the catalogue answers', async () => {
    const catalogue = (url: string) => {
      if (!url.includes('/search/songs')) return new Response('{}', { status: 404 });
      const results = Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, title: `Rain ${i}`, language: 'telugu', year: '2020', image: 'https://img.example/150x150.jpg', more_info: { album: 'Rain', duration: '220', artistMap: { primary_artists: [{ id: `p${i % 4}`, name: `Singer ${i % 4}` }] } } }));
      return new Response(JSON.stringify({ success: true, data: { results } }), { headers: { 'content-type': 'application/json' } });
    };
    const fake = fakeDb({}, (url) => catalogue(url));
    recordingRpc(fake);
    const res = await playlist.onRequestPost({ request: await req('/api/personal/playlist', { method: 'POST', body: { prompt: 'rainy evening telugu songs', count: 8 } }), env: { ...ENV, CATALOG_UPSTREAMS: 'https://wrapper.example' }, waitUntil });
    expect(res.status).toBe(200);
    const page = (await res.json()) as { id: string; title: string; songs: Array<{ id: string; title: string }>; plan: { queries: string[] }; model: string | null };
    expect(page.songs).toHaveLength(8);
    expect(page.songs[0].title).toMatch(/^Rain/);
    expect(page.model).toBeNull();
    expect(page.plan.queries).toEqual(['rainy evening telugu songs']);
    expect(fake.rows('personal_songs').length).toBeGreaterThanOrEqual(12);
    expect(fake.rows('personal_songs').every((r) => r.verified === true)).toBe(true);
    await Promise.all(waits);
    expect(fake.rows('personal_pages')[0]).toMatchObject({ kind: 'playlist', prompt: 'rainy evening telugu songs', composed: false });
    const got = await playlist.onRequestGet({ request: await req(`/api/personal/playlist?id=${page.id}`), env: ENV });
    expect(got.status).toBe(200);
    expect(((await got.json()) as { title: string }).title).toBe(page.title);
  });
});

describe('/api/personal/taste', () => {
  it('is 204 before anything was learned, then the summary', async () => {
    const fake = fakeDb();
    expect((await taste.onRequestGet({ request: await req('/api/personal/taste'), env: ENV })).status).toBe(204);
    fake.rows('personal_taste').push({ account_id: SUB, embed_model: 'm', artists: {}, languages: {}, facets: {}, hours: {}, songs: {}, summary: { lines: ['Listens mostly to telugu (100%).'] }, mode: 'familiar', events_seen: 9, version: 3, updated_at: '2026-10-30T00:00:00.000Z' });
    const res = await taste.onRequestGet({ request: await req('/api/personal/taste'), env: ENV });
    expect(await res.json()).toMatchObject({ mode: 'familiar', eventsSeen: 9, version: 3, hasVector: true, summary: { lines: ['Listens mostly to telugu (100%).'] } });
  });
  it('erases through the database function', async () => {
    const fake = fakeDb();
    fake.answer('rpc/personal_erase', () => new Response(JSON.stringify({ events: 12, exposure: 5, pages: 1, taste: 1 }), { headers: { 'content-type': 'application/json' } }));
    const res = await taste.onRequestDelete({ request: await req('/api/personal/taste', { method: 'DELETE' }), env: ENV });
    expect(await res.json()).toEqual({ erased: { events: 12, exposure: 5, pages: 1, taste: 1 } });
    expect((fake.calls.find((c) => c.table === 'rpc/personal_erase')!.body as { p_account: string }).p_account).toBe(SUB);
  });
});
