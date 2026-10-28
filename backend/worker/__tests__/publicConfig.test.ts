/**
 * 14.0 — the public routes that read the new database: config from the
 * `settings` table (client bundle, banners, festival, flags, site mode,
 * announcements), the blocklist, the active experiments, feedback, and the
 * push registrations. Each also answers its default shape without a database.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSettingsMemo } from '../functions/_lib/settings';
import * as appconfig from '../functions/api/appconfig';
import * as siteMode from '../functions/api/site-mode';
import * as announcements from '../functions/api/announcements';
import * as blocklist from '../functions/api/blocklist';
import * as experiments from '../functions/api/experiments';
import * as feedback from '../functions/api/feedback';
import * as subscribe from '../functions/api/push/subscribe';
import * as fcm from '../functions/api/push/fcm-register';
import * as unsubscribe from '../functions/api/push/unsubscribe';
import { DB_ENV, fakeDb } from './helpers/fakeDb';

const ENV = { ...DB_ENV, DEVICE_ID_SECRET: 'device-secret-for-tests' };
let ip = 0;
const req = (path: string, init: RequestInit = {}, extra: Record<string, string> = {}) =>
  new Request(`https://www.vinaxmusic.online${path}`, { ...init, headers: { 'content-type': 'application/json', 'cf-connecting-ip': `10.55.0.${++ip % 250}`, 'cf-ipcountry': 'IN', ...extra } });
const row = (key: string, value: unknown) => ({ key, value, updated_at: '2026-10-24T09:00:00Z', updated_by: 'owner' });

beforeEach(() => resetSettingsMemo());
afterEach(() => vi.unstubAllGlobals());

describe('/api/appconfig', () => {
  it('serves the published settings, sanitised, and the defaults without a database', async () => {
    fakeDb({ settings: [
      row('greeting', { text: 'Happy Diwali!' }),
      row('banners', [{ id: 'b1', title: 'New in Telugu', linkType: 'playlist', linkId: 'p1', img: 'https://i/b.jpg' }, { title: '' }, { title: 'Old', end: '2020-01-01' }]),
      row('festival', { mode: 'force', id: 'Diwali' }),
      row('flags', { codeRun: false, 'bad name': true, count: 3 }),
    ] });
    const client = (await (await appconfig.onRequestGet({ request: req('/api/appconfig?key=client'), env: ENV })).json()) as { greeting: unknown };
    expect(client.greeting).toEqual({ text: 'Happy Diwali!' });
    expect(await (await appconfig.onRequestGet({ request: req('/api/appconfig?key=banners'), env: ENV })).json()).toEqual({ banners: [{ id: 'b1', title: 'New in Telugu', linkType: 'playlist', linkId: 'p1', img: 'https://i/b.jpg' }] });
    expect(await (await appconfig.onRequestGet({ request: req('/api/appconfig?key=festival'), env: ENV })).json()).toEqual({ festival: { mode: 'force', id: 'diwali' } });
    expect(await (await appconfig.onRequestGet({ request: req('/api/appconfig?key=flags'), env: ENV })).json()).toEqual({ flags: { codeRun: false } });
    expect((await appconfig.onRequestGet({ request: req('/api/appconfig?key=nope'), env: ENV })).status).toBe(400);
    vi.unstubAllGlobals();
    resetSettingsMemo();
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    expect(await (await appconfig.onRequestGet({ request: req('/api/appconfig?key=banners'), env: {} })).json()).toEqual({ banners: [] });
    expect(await (await appconfig.onRequestGet({ request: req('/api/appconfig?key=festival'), env: {} })).json()).toEqual({ festival: null });
    expect(spy).not.toHaveBeenCalled();
  });

  it('one settings read serves every key for a minute', async () => {
    const fake = fakeDb({ settings: [row('flags', { aiHome: true })] });
    await appconfig.onRequestGet({ request: req('/api/appconfig?key=flags'), env: ENV });
    await appconfig.onRequestGet({ request: req('/api/appconfig?key=client'), env: ENV });
    await siteMode.onRequestGet({ env: ENV });
    expect(fake.calls.filter((c) => c.table === 'settings')).toHaveLength(1);
  });
});

describe('/api/site-mode and /api/announcements', () => {
  it('maintenance comes from the switch or an active window; otherwise live', async () => {
    fakeDb({ settings: [row('site-mode', { mode: 'maintenance', note: 'Back in 10 minutes.' })] });
    expect(await (await siteMode.onRequestGet({ env: ENV })).json()).toEqual({ mode: 'maintenance', note: 'Back in 10 minutes.' });
    vi.unstubAllGlobals(); resetSettingsMemo();
    const soon = new Date(Date.now() - 60_000).toISOString();
    const later = new Date(Date.now() + 3_600_000).toISOString();
    fakeDb({ settings: [row('maintenance-window', { start: soon, end: later, note: 'Planned work' })] });
    expect(await (await siteMode.onRequestGet({ env: ENV })).json()).toEqual({ mode: 'maintenance', note: 'Planned work' });
    vi.unstubAllGlobals(); resetSettingsMemo();
    fakeDb();
    expect(await (await siteMode.onRequestGet({ env: ENV })).json()).toEqual({ mode: 'live' });
    expect(await (await siteMode.onRequestGet({ env: {} })).json()).toEqual({ mode: 'live' });
  });

  it('the announcement setting is served with a safe link; junk is null', async () => {
    fakeDb({ settings: [row('announcement', { title: 'Weekend picks', body: 'Fresh songs', link: 'https://evil.example', ts: 1_730_000_000_000 })] });
    expect(await (await announcements.onRequestGet({ env: ENV })).json()).toEqual({ announcement: { title: 'Weekend picks', body: 'Fresh songs', link: '/', ts: 1_730_000_000_000 } });
    vi.unstubAllGlobals(); resetSettingsMemo();
    fakeDb({ settings: [row('announcement', { title: 'No stamp' })] });
    expect(await (await announcements.onRequestGet({ env: ENV })).json()).toEqual({ announcement: null });
    expect(await (await announcements.onRequestGet({ env: {} })).json()).toEqual({ announcement: null });
  });
});

describe('/api/blocklist and /api/experiments', () => {
  it('blocked content is grouped by kind; active experiments carry sanitised variants', async () => {
    fakeDb({
      blocked_content: [{ id: 1, kind: 'song', value: 's1' }, { id: 2, kind: 'artist', value: 'Bad Band' }, { id: 3, kind: 'keyword', value: 'remix' }, { id: 4, kind: 'other', value: 'x' }],
      experiments: [{ key: 'home-v2', variants: [{ name: 'a', pct: 50 }, { name: 'b', pct: 50 }], active: true }, { key: 'off', variants: [{ name: 'a', pct: 100 }], active: false }, { key: 'empty', variants: [], active: true }],
    });
    expect(await (await blocklist.onRequestGet({ env: ENV })).json()).toEqual({ ids: ['s1'], artists: ['Bad Band'], keywords: ['remix'] });
    expect(await (await experiments.onRequestGet({ env: ENV })).json()).toEqual({ experiments: [{ key: 'home-v2', variants: [{ name: 'a', pct: 50 }, { name: 'b', pct: 50 }] }] });
    expect(await (await blocklist.onRequestGet({ env: {} })).json()).toEqual({ ids: [], artists: [], keywords: [] });
    expect(await (await experiments.onRequestGet({ env: {} })).json()).toEqual({ experiments: [] });
  });
});

describe('/api/feedback', () => {
  it('stores the message with coarse geo and the derived listener id; empty is 400; no database is 503', async () => {
    const fake = fakeDb();
    const res = await feedback.onRequestPost({ request: req('/api/feedback', { method: 'POST', body: JSON.stringify({ type: 'bug', message: '  Lyrics are off  ', name: 'V', deviceId: 'install-uuid-0001', platform: 'android', appVersion: '14.0.0' }) }), env: ENV });
    expect(await res.json()).toEqual({ ok: true });
    const r = fake.rows('feedback')[0];
    expect(r).toMatchObject({ kind: 'bug', message: 'Lyrics are off', name: 'V', platform: 'android', app_version: '14.0.0', country: 'IN' });
    expect(String(r.listener_id)).toMatch(/^d_[a-f0-9]{32}$/);
    expect((await feedback.onRequestPost({ request: req('/api/feedback', { method: 'POST', body: JSON.stringify({ type: 'weird', message: '' }) }), env: ENV })).status).toBe(400);
    expect((await feedback.onRequestPost({ request: req('/api/feedback', { method: 'POST', body: JSON.stringify({ message: 'x' }) }), env: {} })).status).toBe(503);
    expect((await feedback.onRequestGet()).status).toBe(405);
  });
});

describe('push registrations', () => {
  it('a browser subscription becomes a web push_devices row; unknown hosts are refused', async () => {
    const fake = fakeDb();
    const good = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'p'.repeat(20), auth: 'a'.repeat(10) }, lang: 'te-IN', tzOffset: 330 };
    expect(await (await subscribe.onRequestPost({ request: req('/api/push/subscribe', { method: 'POST', body: JSON.stringify(good) }), env: ENV })).json()).toEqual({ ok: true });
    expect(fake.rows('push_devices')[0]).toMatchObject({ channel: 'web', target: good.endpoint, p256dh: good.keys.p256dh, auth: good.keys.auth, lang: 'te-in', country: 'IN', tz_offset: 330, active: true });
    const bad = await subscribe.onRequestPost({ request: req('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ ...good, endpoint: 'https://evil.example/hook' }) }), env: ENV });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'endpoint_rejected' });
    expect((await subscribe.onRequestPost({ request: req('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ endpoint: good.endpoint }) }), env: ENV })).status).toBe(400);
    expect((await subscribe.onRequestPost({ request: req('/api/push/subscribe', { method: 'POST', body: JSON.stringify(good) }), env: {} })).status).toBe(503);
  });

  it('an Android token becomes an fcm row; unsubscribe is same-origin and switches a row off', async () => {
    const fake = fakeDb();
    const token = 't'.repeat(40);
    expect(await (await fcm.onRequestPost({ request: req('/api/push/fcm-register', { method: 'POST', body: JSON.stringify({ token, platform: 'android', lang: 'hi', tzOffset: 9999 }) }), env: ENV })).json()).toEqual({ ok: true });
    expect(fake.rows('push_devices')[0]).toMatchObject({ channel: 'fcm', target: token, platform: 'android', lang: 'hi', tz_offset: null, active: true });
    expect((await fcm.onRequestPost({ request: req('/api/push/fcm-register', { method: 'POST', body: JSON.stringify({ token: 'short' }) }), env: ENV })).status).toBe(400);
    expect((await fcm.onRequestOptions()).status).toBe(204);

    fake.rows('push_devices').push({ channel: 'web', target: 'https://fcm.googleapis.com/fcm/send/abc', active: true });
    const foreign = await unsubscribe.onRequestPost({ request: req('/api/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc' }) }, { origin: 'https://evil.example' }), env: ENV });
    expect(foreign.status).toBe(403);
    const own = await unsubscribe.onRequestPost({ request: req('/api/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc' }) }, { origin: 'https://www.vinaxmusic.online' }), env: ENV });
    expect(await own.json()).toEqual({ ok: true });
    expect(fake.rows('push_devices').find((r) => r.channel === 'web')?.active).toBe(false);
  });
});
