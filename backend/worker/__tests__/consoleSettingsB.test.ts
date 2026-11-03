/**
 * Console rebuild — App Settings › Maintenance, Search & Music Sources and
 * Help Center: what the Worker hands the app from the new setting shapes, the
 * status page note's level and switch, and read-only mode refusing writes.
 * Every old shape keeps working.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { maintenanceActive, publicClientConfig, publicSiteMode, upcomingMaintenance } from '../functions/_lib/clientConfig';
import { readOnlyRefusal, READ_ONLY_PATHS } from '../functions/_lib/readOnly';
import { onRequestGet as statusGet, resetStatusMemo } from '../functions/api/status';
import { resetSettingsMemo } from '../functions/_lib/settings';
import { DB_ENV, fakeDb } from './helpers/fakeDb';

const NOW = new Date('2026-11-02T12:00:00Z');
const iso = (minFromNow: number) => new Date(NOW.getTime() + minFromNow * 60_000).toISOString();

beforeEach(() => {
  resetSettingsMemo();
  resetStatusMemo();
  vi.unstubAllGlobals();
});

describe('Music Sources', () => {
  it('passes the priority order and the switched-off sources; the old map still works', () => {
    const c = publicClientConfig({ 'catalog-sources': { sirimilla: false, _order: ['sirimilla', 'local-catalog', 'Bad Id!'] } }, NOW);
    expect(c.disabledSources).toEqual(['sirimilla']);
    expect(c.sourceOrder).toEqual(['sirimilla', 'local-catalog']);
    const old = publicClientConfig({ 'catalog-sources': { 'local-catalog': false } }, NOW);
    expect(old.disabledSources).toEqual(['local-catalog']);
    expect(old.sourceOrder).toEqual([]);
  });
});

describe('Language Order', () => {
  it('reads { order, hidden } and the old plain list', () => {
    const c = publicClientConfig({ 'language-order': { order: ['telugu', 'hindi', 'telugu'], hidden: ['urdu', 'NOPE'] } }, NOW);
    expect(c.languageOrder).toEqual(['telugu', 'hindi']);
    expect(c.hiddenLanguages).toEqual(['urdu']);
    const old = publicClientConfig({ 'language-order': ['tamil', 'english'] }, NOW);
    expect(old.languageOrder).toEqual(['tamil', 'english']);
    expect(old.hiddenLanguages).toEqual([]);
  });
});

describe('Help Center', () => {
  it('drops switched-off questions and keeps the category', () => {
    const c = publicClientConfig({ 'support-faq': [
      { q: 'How do I download?', a: 'Tap Download.', category: 'Downloads & offline', enabled: true },
      { q: 'Hidden one', a: 'Not shown.', enabled: false },
      { q: 'Old style', a: 'No category or switch.' },
    ] }, NOW);
    expect(c.faq).toEqual([
      { q: 'How do I download?', a: 'Tap Download.', category: 'Downloads & offline' },
      { q: 'Old style', a: 'No category or switch.' },
    ]);
  });
});

describe('Scheduled Maintenance', () => {
  it('announces a coming window from warnBefore, and is active inside it', () => {
    const w = { enabled: true, start: iso(30), end: iso(90), note: 'Back soon', warnBefore: 60 };
    const up = upcomingMaintenance(w, NOW)!;
    expect(up.start).toBe(iso(30));
    expect(up.warnFrom).toBe(iso(-30));
    expect(up.note).toBe('Back soon');
    expect(maintenanceActive(w, NOW)).toBeNull();
    expect(maintenanceActive(w, new Date(NOW.getTime() + 45 * 60_000))).toEqual({ note: 'Back soon' });
    expect(publicClientConfig({ 'maintenance-window': w }, NOW).maintenance?.warnFrom).toBe(iso(-30));
  });

  it('a switched-off window does nothing; an old window without the switch is on; an odd warning time falls back to one hour', () => {
    expect(upcomingMaintenance({ enabled: false, start: iso(10), end: iso(20) }, NOW)).toBeNull();
    expect(maintenanceActive({ enabled: false, start: iso(-10), end: iso(20) }, NOW)).toBeNull();
    expect(maintenanceActive({ start: iso(-10), end: iso(20) }, NOW)).toEqual({ note: '' });
    expect(upcomingMaintenance({ start: iso(120), end: iso(180), warnBefore: 7 }, NOW)?.warnFrom).toBe(iso(60));
    expect(upcomingMaintenance({ start: iso(5000), end: iso(5100) }, NOW)).toBeNull(); // more than two days away
    expect(publicClientConfig({}, NOW).maintenance).toBeUndefined();
  });
});

describe('Site Mode', () => {
  it('read-only is its own mode, with the note and any coming window', () => {
    const w = { start: iso(30), end: iso(90), warnBefore: 60 };
    expect(publicSiteMode({ 'site-mode': { mode: 'readonly', note: 'Paused' }, 'maintenance-window': w }, NOW)).toEqual({
      mode: 'readonly', note: 'Paused', upcoming: { start: iso(30), end: iso(90), warnFrom: iso(-30) },
    });
    expect(publicSiteMode({ 'maintenance-window': w }, NOW)).toEqual({ mode: 'live', upcoming: { start: iso(30), end: iso(90), warnFrom: iso(-30) } });
  });

  it('maintenance and an active window still win', () => {
    expect(publicSiteMode({ 'site-mode': { mode: 'maintenance', note: 'x' } }, NOW)).toEqual({ mode: 'maintenance', note: 'x' });
    expect(publicSiteMode({ 'site-mode': { mode: 'readonly' }, 'maintenance-window': { start: iso(-5), end: iso(5) } }, NOW)).toEqual({ mode: 'maintenance' });
    expect(publicSiteMode({}, NOW)).toEqual({ mode: 'live' });
  });
});

describe('read-only mode refuses saving writes', () => {
  it('refuses a write to a saving route only while read-only', async () => {
    fakeDb({ settings: [{ key: 'site-mode', value: { mode: 'readonly' }, updated_at: 'x', updated_by: 'owner' }] });
    const r = await readOnlyRefusal('/api/feedback', 'POST', DB_ENV);
    expect(r?.status).toBe(503);
    expect(((await r!.json()) as { error: string }).error).toBe('read_only');
    expect(r!.headers.get('access-control-allow-origin')).toBe('*');
    expect(await readOnlyRefusal('/api/account/data/', 'PUT', DB_ENV)).not.toBeNull();
    expect(await readOnlyRefusal('/api/feedback', 'GET', DB_ENV)).toBeNull();
    expect(await readOnlyRefusal('/api/events', 'POST', DB_ENV)).toBeNull(); // listening keeps working
    expect(await readOnlyRefusal('/api/room', 'POST', DB_ENV)).toBeNull();
    expect(READ_ONLY_PATHS).toContain('/api/profile');
  });

  it('lets writes through when the site is live or has no database', async () => {
    fakeDb({ settings: [{ key: 'site-mode', value: { mode: 'live' }, updated_at: 'x', updated_by: 'owner' }] });
    expect(await readOnlyRefusal('/api/feedback', 'POST', DB_ENV)).toBeNull();
    resetSettingsMemo();
    expect(await readOnlyRefusal('/api/feedback', 'POST', {})).toBeNull();
  });
});

describe('Status Page Note', () => {
  const req = () => new Request('https://www.vinaxmusic.online/api/status', { headers: { 'cf-connecting-ip': '10.88.0.1' } });
  const run = async (value: unknown) => {
    resetStatusMemo();
    resetSettingsMemo();
    const fake = fakeDb({ settings: [{ key: 'status-note', value, updated_at: 'x', updated_by: 'owner' }] });
    fake.answer('rpc/uptime_report', () => new Response('[]', { headers: { 'content-type': 'application/json' } }));
    return (await (await statusGet({ request: req(), env: DB_ENV })).json()) as { note: string | null; noteLevel: string | null };
  };

  it('carries the level, hides a switched-off note, and leaves an old note without a level', async () => {
    expect(await run({ text: 'Search is slow', level: 'major', enabled: true })).toMatchObject({ note: 'Search is slow', noteLevel: 'major' });
    expect(await run({ text: 'Hidden', level: 'minor', enabled: false })).toMatchObject({ note: null, noteLevel: null });
    expect(await run({ text: 'Old note' })).toMatchObject({ note: 'Old note', noteLevel: null });
  });
});
