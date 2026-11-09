/**
 * Automatic notifications (schema 18): when each kind is due in a person's
 * own time, what the messages say, how the caps hold (dedupe keys, the
 * per-person gap, three unanswered), artist matching against the catalogue,
 * the job's run and the console's preview. The database is faked; no push
 * service and no catalogue is ever called for real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DB_ENV, fakeDb, type FakeDb } from './helpers/fakeDb';
import { issueAdminSession, resetAdminMemo } from '../functions/_lib/adminAuth';
import { JOBS } from '../functions/_lib/jobs';
import {
  asRecaps, byArtist, daytime, isFresh, KIND_INFO, localParts, newest, outreachSettingsOf, PER_RUN, recapMessage, recapWeek, releaseMessage,
  runOutreach, sendOutreachPreview, winbackMessage,
} from '../functions/_lib/outreach';
import { resetSettingsMemo } from '../functions/_lib/settings';
import { _resetRateLimitsForTests } from '../functions/_lib/ratelimit';
import type { CatalogCandidate } from '../functions/_lib/trends/matcher';
import * as route from '../functions/api/admin/outreach';

const ENV = { AUTH_SECRET: 'auth-secret-for-tests', ...DB_ENV, ADMIN_LOGIN_PASSWORD: 'owner-pass', FCM_SERVICE_ACCOUNT: '', VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '' };
const IST = 330;
// Sunday 8 Nov 2026, 19:00 IST = 13:30 UTC.
const SUN_1900_IST = Date.UTC(2026, 10, 8, 13, 30);
const SUN_1859_IST = SUN_1900_IST - 60_000;
const MON_1100_IST = Date.UTC(2026, 10, 9, 5, 30);
const MON_1300_IST = Date.UTC(2026, 10, 9, 7, 30);
// Tuesday 10 Nov 2026 at 14:00 IST.
const TUE_1400_IST = Date.UTC(2026, 10, 10, 8, 30);

const song = (id: string, title: string, artists: string[], releaseDate: string | null = null, year = 2026): CatalogCandidate =>
  ({ id, title, primaryArtists: artists, featuredArtists: [], credits: [], album: null, language: 'telugu', year, releaseDate, image: null });

let sent: Array<{ url: string; body: unknown }> = [];
/** Nothing outside the database is real: FCM/web push are not configured, so fan-outs count devices and send nothing. */
const outside = (url: string, init?: RequestInit): Response => {
  sent.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
  return new Response('{}', { status: 200 });
};

beforeEach(() => { sent = []; resetSettingsMemo(); resetAdminMemo(); _resetRateLimitsForTests(); });
afterEach(() => vi.unstubAllGlobals());

describe('when each kind is due, in the person’s own time', () => {
  it('reads the weekday and hour where the person is; India when unknown', () => {
    expect(localParts(SUN_1900_IST, IST)).toEqual({ dow: 0, hour: 19, date: '2026-11-08' });
    expect(localParts(SUN_1900_IST, null)).toEqual({ dow: 0, hour: 19, date: '2026-11-08' });
    expect(localParts(SUN_1900_IST, -300)).toMatchObject({ dow: 0, hour: 8 }); // New York, still morning
    expect(localParts(SUN_1900_IST, 99_999)).toMatchObject({ hour: 19 }); // a nonsense offset reads as India
  });
  it('the recap: Sunday from 7 PM, caught up Monday before noon, keyed by the Sunday', () => {
    expect(recapWeek(SUN_1859_IST, IST)).toBeNull();
    expect(recapWeek(SUN_1900_IST, IST)).toBe('2026-11-08');
    expect(recapWeek(MON_1100_IST, IST)).toBe('2026-11-08');
    expect(recapWeek(MON_1300_IST, IST)).toBeNull();
    expect(recapWeek(SUN_1900_IST, -300)).toBeNull(); // not evening yet in New York
    expect(recapWeek(SUN_1900_IST + 11 * 3_600_000, -300)).toBe('2026-11-08'); // 19:00 there
  });
  it('win-back and releases go out in the daytime only', () => {
    expect(daytime(TUE_1400_IST, IST)).toBe(true);
    expect(daytime(Date.UTC(2026, 10, 10, 17, 0), IST)).toBe(false); // 22:30 IST
    expect(daytime(Date.UTC(2026, 10, 10, 17, 0), -300)).toBe(true); // noon in New York
  });
  it('is an hourly job the console lists, and every kind is on until switched off', () => {
    expect(JOBS.find((j) => j.id === 'outreach')).toMatchObject({ every: 60 });
    expect(outreachSettingsOf(null)).toEqual({ recap: true, winback: true, release: true });
    expect(outreachSettingsOf({ winback: false, release: 'yes' })).toEqual({ recap: true, winback: false, release: true });
    expect(KIND_INFO.winback.rule).toBe('reminders');
    expect(KIND_INFO.release.rule).toBe('releases');
    expect(PER_RUN.recap).toBeGreaterThan(PER_RUN.winback);
  });
});

describe('what the messages say', () => {
  it('the recap names the time, the top artist and the most played song', () => {
    expect(recapMessage({ seconds: 3 * 3600 + 12 * 60, topArtist: 'A.R. Rahman', topSong: 'Kanne Kanne' })).toEqual({
      title: 'Your week in VinaX', body: '3 h 12 min of music · top artist A.R. Rahman · most played “Kanne Kanne”. Tap for your week.', link: '/weekly',
    });
    expect(recapMessage({ seconds: 45 * 60, topArtist: null, topSong: null }).body).toBe('45 min of music. Tap for your week.');
  });
  it('the win-back names a recent song, or the artist, or just invites them back', () => {
    const s = song('s1', 'Chuttamalle', ['Anirudh Ravichander'], '2026-11-07');
    expect(winbackMessage({ name: 'Asha Rao', topArtist: 'Anirudh' }, s)).toEqual({ title: 'New from Anirudh Ravichander', body: '“Chuttamalle” and more from Anirudh Ravichander are waiting for you on VinaX.', link: '/song/s1', image: null });
    expect(winbackMessage({ name: 'Asha Rao', topArtist: 'Anirudh' }, null)).toEqual({ title: 'Asha, your music missed you', body: 'Songs from Anirudh are waiting for you. Tap to pick up where you left off.', link: '/' });
    expect(winbackMessage({ name: null, topArtist: null }, null)).toMatchObject({ title: 'Your music missed you', link: '/' });
  });
  it('one new song, or several from several artists', () => {
    const a = song('s1', 'Chuttamalle', ['Anirudh'], '2026-11-08');
    const b = song('s2', 'Srivalli', ['Sid Sriram'], '2026-11-08');
    const c = song('s3', 'Tum Se', ['Arijit Singh'], '2026-11-08');
    expect(releaseMessage([a])).toEqual({ title: 'New from Anirudh', body: '“Chuttamalle” is out now. Tap to listen.', link: '/song/s1', image: null });
    expect(releaseMessage([a, b])).toMatchObject({ title: '2 new songs from Anirudh and Sid Sriram', link: '/song/s1' });
    expect(releaseMessage([a, b, c]).title).toBe('3 new songs from Anirudh, Sid Sriram and more');
    expect(releaseMessage([a, b, c]).body).toBe('“Chuttamalle” by Anirudh, “Srivalli” by Sid Sriram, “Tum Se” by Arijit Singh. Tap to listen.');
  });
});

describe('the catalogue', () => {
  it('matches artists across spellings, not across different people', () => {
    const s = song('s', 'x', ['A.R. Rahman'], null);
    expect(byArtist(s, 'A R Rahman')).toBe(true);
    expect(byArtist(s, 'A. R. Rahman')).toBe(true);
    expect(byArtist(song('s', 'x', ['Anirudh Ravichander'], null), 'Anirudh Ravichander')).toBe(true);
    expect(byArtist(s, 'AR')).toBe(false);
    expect(byArtist(song('s', 'x', ['Sid Sriram'], null), 'Sriram')).toBe(true); // a longer credit of the same name
    expect(byArtist(song('s', 'x', ['Anirudh Ravichander'], null), 'Arijit Singh')).toBe(false);
    expect(byArtist(song('s', 'x', ['Devi Sri Prasad'], null), 'DSP')).toBe(false);
  });
  it('fresh means released in the last day and a half; newest picks by date then year', () => {
    const now = Date.UTC(2026, 10, 10, 8, 30);
    expect(isFresh(song('a', 'a', [], '2026-11-10'), now)).toBe(true);
    expect(isFresh(song('a', 'a', [], '2026-11-09'), now)).toBe(true);
    expect(isFresh(song('a', 'a', [], '2026-11-08'), now)).toBe(false);
    expect(isFresh(song('a', 'a', [], '2026-11-11'), now)).toBe(true); // dated tomorrow in another zone
    expect(isFresh(song('a', 'a', [], null), now)).toBe(false);
    expect(newest([song('old', 'o', [], null, 2019), song('new', 'n', [], '2026-11-01'), song('mid', 'm', [], null, 2024)])?.id).toBe('new');
    expect(newest([])).toBeNull();
  });
});

const SETTINGS_OFF = (value: Record<string, unknown>) => [{ key: 'outreach', value, updated_at: 't', updated_by: 'o' }];
const DEVICES = [
  { id: 1, channel: 'fcm', target: 'tok-asha', p256dh: null, auth: null, account_id: '111', active: true, last_pushed_at: null, tz_offset: IST },
  { id: 2, channel: 'web', target: 'https://push.example/asha', p256dh: 'k', auth: 'a', account_id: '111', active: true, last_pushed_at: null, tz_offset: IST },
  { id: 3, channel: 'fcm', target: 'tok-ravi', p256dh: null, auth: null, account_id: '222', active: true, last_pushed_at: null, tz_offset: IST },
];
const RECAPS = [
  { id: '111', name: 'Asha Rao', email: 'asha@example.com', tzOffset: IST, seconds: 11_520, plays: 80, days: 6, topArtist: 'Anirudh', topSong: 'Chuttamalle', topSongId: 's1', topSongArtist: 'Anirudh' },
  { id: '222', name: 'Ravi', email: 'ravi@example.com', tzOffset: -300, seconds: 4000, plays: 20, days: 3, topArtist: null, topSong: null, topSongId: null, topSongArtist: null },
];
const rpc = (fake: FakeDb, fn: string, value: unknown) => fake.answer(`rpc/${fn}`, () => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } }));
const CAT = { search: vi.fn(async () => [] as CatalogCandidate[]), newReleases: vi.fn(async () => [] as CatalogCandidate[]) };

describe('the job', () => {
  it('the recap goes to the people whose Sunday evening it is, once, with a row each and one notifications row', async () => {
    const fake = fakeDb({ push_devices: DEVICES, notifications: [], outreach: [] }, outside);
    rpc(fake, 'outreach_recap', RECAPS);
    rpc(fake, 'outreach_winback', []);
    rpc(fake, 'outreach_release_people', []);
    const r = await runOutreach(ENV as never, SUN_1900_IST, CAT);
    expect(r.recap).toMatchObject({ candidates: 2, due: 1, people: 1, skipped: { notTheirEveningYet: 1 } });
    expect(r.winback).toMatchObject({ candidates: 0, people: 0 });
    const rows = fake.rows('outreach');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ account_id: '111', kind: 'recap', dedupe_key: 'recap:2026-11-08:111', title: 'Your week in VinaX', link: '/weekly', facts: expect.objectContaining({ seconds: 11_520, topArtist: 'Anirudh' }) });
    expect(fake.rows('notifications')).toEqual([expect.objectContaining({ kind: 'recap', title: 'Weekly recap', sent_by: 'auto', audience: { label: 'Automatic · Weekly recap', auto: 'recap' } })]);
    expect(asRecaps(RECAPS)[1].tzOffset).toBe(-300);
    // The database said what the Worker asked: the last seven days, 30 minutes at least.
    expect(fake.calls.find((c) => c.table === 'rpc/outreach_recap')?.body).toEqual({ p_since: new Date(SUN_1900_IST - 7 * 86_400_000).toISOString(), p_min_seconds: 1800 });
  });

  it('a person already sent this week is skipped (the dedupe key), and nobody is sent in quiet hours or when the kind is off', async () => {
    const fake = fakeDb({ push_devices: DEVICES, notifications: [], outreach: [] }, outside);
    rpc(fake, 'outreach_recap', RECAPS);
    rpc(fake, 'outreach_winback', []);
    rpc(fake, 'outreach_release_people', []);
    fake.answer('outreach', (call) => call.method === 'POST'
      ? new Response(JSON.stringify({ code: '23505', message: 'duplicate key' }), { status: 409, headers: { 'content-type': 'application/json' } })
      : new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }));
    expect((await runOutreach(ENV as never, SUN_1900_IST, CAT)).recap).toMatchObject({ due: 1, people: 0, skipped: { alreadySent: 1 } });
    resetSettingsMemo();
    fakeDb({ settings: [{ key: 'push', value: { quiet: { enabled: true, start: '18:00', end: '08:00' } }, updated_at: 't', updated_by: 'o' }] }, outside);
    expect(await runOutreach(ENV as never, SUN_1900_IST, CAT)).toMatchObject({ waiting: 'quiet_hours' });
    resetSettingsMemo();
    fakeDb({ settings: [...SETTINGS_OFF({ recap: false, winback: false, release: false })] }, outside);
    expect(await runOutreach(ENV as never, SUN_1900_IST, CAT)).toEqual({ recap: 'off', winback: 'off', release: 'off' });
    resetSettingsMemo();
    fakeDb({ settings: [{ key: 'push', value: { types: { reminders: false, releases: false } }, updated_at: 't', updated_by: 'o' }] }, outside);
    const r = await runOutreach(ENV as never, MON_1300_IST, CAT);
    expect(r.winback).toMatch(/^off \(Reminders/);
    expect(r.release).toMatch(/^off \(New releases/);
  });

  it('win-back: the daytime, a week between nudges, three unanswered at most, a recent song from the catalogue', async () => {
    const fake = fakeDb({ push_devices: DEVICES, notifications: [], outreach: [] }, outside);
    rpc(fake, 'outreach_recap', []);
    rpc(fake, 'outreach_release_people', []);
    rpc(fake, 'outreach_winback', [
      { id: '111', name: 'Asha Rao', tzOffset: IST, lastActive: '2026-10-30T10:00:00Z', topArtist: 'Anirudh', lastWinbackAt: null, unanswered: 0 },
      { id: '222', name: 'Ravi', tzOffset: IST, lastActive: '2026-10-29T10:00:00Z', topArtist: 'Anirudh', lastWinbackAt: '2026-11-08T08:00:00Z', unanswered: 1 },
      { id: '333', name: 'Gone', tzOffset: IST, lastActive: '2026-10-20T10:00:00Z', topArtist: 'DSP', lastWinbackAt: '2026-10-28T08:00:00Z', unanswered: 3 },
      { id: '444', name: 'Night', tzOffset: -300, lastActive: '2026-10-30T10:00:00Z', topArtist: null, lastWinbackAt: null, unanswered: 0 },
    ]);
    const cat = { ...CAT, search: vi.fn(async () => [song('old', 'Old Hit', ['Anirudh'], null, 2018), song('new', 'Chuttamalle', ['Anirudh Ravichander'], '2026-11-01'), song('other', 'Nope', ['Someone Else'], '2026-11-09')]) };
    const r = await runOutreach(ENV as never, Date.UTC(2026, 10, 10, 3, 30), cat); // 09:00 IST Tuesday, 23:00 the day before in New York
    expect(r.winback).toMatchObject({ candidates: 4, due: 1, people: 1, skipped: { nudgedThisWeek: 1, threeUnanswered: 1, notTheirDaytime: 1 } });
    expect(cat.search).toHaveBeenCalledTimes(1);
    expect(fake.rows('outreach')).toEqual([expect.objectContaining({ account_id: '111', kind: 'winback', dedupe_key: 'winback:111:2026-11-10', title: 'New from Anirudh Ravichander', link: '/song/new', facts: expect.objectContaining({ songIds: ['new'] }) })]);
  });

  it('new releases: fresh songs by a person’s artists, never one already sent, one push a day', async () => {
    const fake = fakeDb({ push_devices: DEVICES, notifications: [], outreach: [] }, outside);
    rpc(fake, 'outreach_recap', []);
    rpc(fake, 'outreach_winback', []);
    rpc(fake, 'outreach_release_people', [
      { id: '111', name: 'Asha Rao', tzOffset: IST, artists: ['Anirudh', 'Sid Sriram', 'DSP'], languages: ['telugu', 'tamil'], sentSongs: ['already'], lastReleaseAt: null },
      { id: '222', name: 'Ravi', tzOffset: IST, artists: ['Arijit Singh'], languages: ['hindi'], sentSongs: [], lastReleaseAt: '2026-11-10T04:00:00Z' },
      { id: '555', name: 'Mo', tzOffset: IST, artists: ['Nobody Famous'], languages: ['telugu'], sentSongs: [], lastReleaseAt: null },
    ]);
    const cat = {
      newReleases: vi.fn(async (lang: string) => lang === 'telugu'
        ? [song('already', 'Sent Before', ['Anirudh'], '2026-11-10'), song('fresh1', 'Chuttamalle', ['Anirudh Ravichander'], '2026-11-10'), song('stale', 'Old', ['Anirudh'], '2026-11-01')]
        : lang === 'tamil' ? [song('fresh2', 'Srivalli', ['Sid Sriram'], '2026-11-09')] : []),
      search: vi.fn(async (q: string) => (q === 'DSP' ? [song('fresh3', 'Oo Antava', ['Devi Sri Prasad'], '2026-11-10')] : [])),
    };
    const now = Date.UTC(2026, 10, 10, 8, 30); // 14:00 IST
    const r = await runOutreach(ENV as never, now, cat);
    expect(r.release).toMatchObject({ candidates: 3, due: 2, people: 1, skipped: { alreadyToday: 1, nothingNewForThem: 1, freshSongsFound: 3 } });
    // Only the languages of people who are due are fetched (Ravi already had today's).
    expect(cat.newReleases.mock.calls.map((c) => c[0]).sort()).toEqual(['tamil', 'telugu']);
    const [row] = fake.rows('outreach');
    expect(row).toMatchObject({ account_id: '111', kind: 'release', dedupe_key: 'release:111:2026-11-10', title: '2 new songs from Anirudh Ravichander and Sid Sriram', facts: { songIds: ['fresh1', 'fresh2'], titles: ['Chuttamalle', 'Srivalli'], artists: ['Anirudh Ravichander', 'Sid Sriram'] } });
    expect(fake.rows('notifications')).toEqual([expect.objectContaining({ kind: 'release', title: 'New releases' })]);
  });

  it('a database before version 18 fails the kind, not the job', async () => {
    const fake = fakeDb({ push_devices: DEVICES }, outside);
    fake.answer('rpc/outreach_recap', () => new Response(JSON.stringify({ code: 'PGRST202', message: 'no function' }), { status: 404, headers: { 'content-type': 'application/json' } }));
    rpc(fake, 'outreach_winback', []);
    rpc(fake, 'outreach_release_people', []);
    const r = await runOutreach(ENV as never, SUN_1900_IST, CAT);
    expect(r.recap).toMatchObject({ error: expect.stringMatching(/outreach_recap unreadable/) });
    expect(r.winback).toMatchObject({ candidates: 0 });
  });
});

describe('the console', () => {
  const ADMINS = [
    { email: 'boss@example.com', role: 'owner', name: 'Boss', picture: null, invited_by: null, created_at: 't', last_sign_in: null },
    { email: 'ed@example.com', role: 'editor', name: null, picture: null, invited_by: null, created_at: 't', last_sign_in: null },
    { email: 'viewer@example.com', role: 'viewer', name: null, picture: null, invited_by: null, created_at: 't', last_sign_in: null },
  ];
  const req = (body?: unknown, token?: string, qs = '') => new Request(`https://admin.vinaxmusic.online/api/admin/outreach${qs}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { 'x-admin-token': token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  type H = (ctx: { request: Request; env: Record<string, unknown> }) => Promise<Response>;
  const call = async (h: unknown, r: Request) => { const res = await (h as H)({ request: r, env: ENV }); return { status: res.status, body: await res.json() as Record<string, unknown> }; };
  const tokenFor = async (email: string) => (await issueAdminSession(ENV, email))!;

  it('lists the settings, the rules, the job and the summary; says when the database is old', async () => {
    const fake = fakeDb({ admins: ADMINS, job_runs: [{ job: 'outreach', started_at: '2026-11-10T08:00:00Z', ok: true, summary: { recap: 'off' } }] }, outside);
    rpc(fake, 'outreach_summary', { days: 14, kinds: { recap: { people: 2 } }, runs: [], latest: [], byDay: [] });
    const r = await call(route.onRequestGet, req(undefined, await tokenFor('viewer@example.com'), '?days=14'));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ settings: { recap: true, winback: true, release: true }, rules: { reminders: true, releases: true }, kinds: { recap: { label: 'Weekly recap' } }, job: { at: '2026-11-10T08:00:00Z', ok: true }, summary: { kinds: { recap: { people: 2 } } } });
    expect(fake.calls.find((c) => c.table === 'rpc/outreach_summary')?.body).toEqual({ p_days: 14 });
    const old = fakeDb({ admins: ADMINS }, outside);
    old.answer('rpc/outreach_summary', () => new Response(JSON.stringify({ code: 'PGRST202', message: 'no function' }), { status: 404, headers: { 'content-type': 'application/json' } }));
    const r2 = await call(route.onRequestGet, req(undefined, await tokenFor('viewer@example.com')));
    expect(r2).toMatchObject({ status: 502, body: { error: 'db_update_needed' } });
  });

  it('the preview goes to the signed-in admin’s own devices, marked, and never leaves a row; a run needs an Owner', async () => {
    const fake = fakeDb({ admins: ADMINS, accounts: [{ id: '111', email: 'ed@example.com' }], push_devices: DEVICES, outreach: [], notifications: [] }, outside);
    rpc(fake, 'outreach_recap', [RECAPS[0]]);
    const editor = await tokenFor('ed@example.com');
    const r = await call(route.onRequestPost, req({ action: 'preview', kind: 'recap' }, editor));
    expect(r).toMatchObject({ status: 200, body: { ok: true, devices: 2, real: true, message: { title: '[Preview] Your week in VinaX', link: '/weekly' } } });
    expect(fake.rows('outreach')).toEqual([]);
    expect(fake.rows('notifications')).toEqual([]);
    expect(fake.calls.filter((c) => c.table === 'push_devices' && c.method === 'PATCH')).toEqual([]); // not counted toward the cap
    expect((await call(route.onRequestPost, req({ action: 'preview', kind: 'poke' }, editor))).status).toBe(400);
    expect((await call(route.onRequestPost, req({ action: 'preview', kind: 'recap' }, await tokenFor('viewer@example.com')))).status).toBe(403);
    expect((await call(route.onRequestPost, req({ action: 'run' }, editor))).status).toBe(403);
    const nobody = fakeDb({ admins: ADMINS, accounts: [{ id: '999', email: 'boss@example.com' }], push_devices: [] }, outside);
    rpc(nobody, 'outreach_recap', []);
    expect(await call(route.onRequestPost, req({ action: 'preview', kind: 'winback' }, await tokenFor('boss@example.com')))).toMatchObject({ status: 409, body: { error: 'no_devices' } });
  });

  it('a preview with no listening of your own uses sample numbers', async () => {
    const fake = fakeDb({ admins: ADMINS, accounts: [{ id: '111', email: 'ed@example.com' }], push_devices: DEVICES }, outside);
    rpc(fake, 'outreach_recap', []);
    const r = await sendOutreachPreview(ENV as never, 'recap', 'ed@example.com', SUN_1900_IST, CAT);
    expect(r).toMatchObject({ ok: true, real: false, message: { body: expect.stringContaining('3 h 12 min of music · top artist A.R. Rahman') } });
    const w = await sendOutreachPreview(ENV as never, 'winback', 'ed@example.com', SUN_1900_IST, CAT);
    expect(w).toMatchObject({ ok: true, message: { title: '[Preview] Your music missed you' } });
  });
});
