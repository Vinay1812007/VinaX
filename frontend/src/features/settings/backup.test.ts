// @vitest-environment jsdom
/**
 * Backup schema v2 — round trips, legacy migration, malformed-file safety
 * and storage-failure rollback. Everything here runs against jsdom's real
 * localStorage so "nothing changed" is checked on the actual store.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KEYS } from '@/constants/storage-keys';
import type { Song } from '@/types';

vi.mock('@/services/native', async (importOriginal) => ({ ...(await importOriginal<object>()), isNativePlatform: () => false }));
vi.mock('@/services/ai/recommendations', () => ({ requestCurator: async () => null }));
vi.mock('@/services/ai/taste', () => ({ buildTasteSnapshot: () => ({}) }));

import {
  BACKUP_CATEGORIES,
  BACKUP_FORMAT,
  BACKUP_SCHEMA_VERSION,
  applyBackup,
  applyTransferPayload,
  backupMeta,
  createBackup,
  createTransferPayload,
  parseBackup,
  serializeBackup,
} from './backup';
import { importProfileJson } from './actions';

const song = (id: string, title = `Song ${id}`, artist = 'Artist'): Song => ({
  kind: 'song',
  id,
  title,
  subtitle: artist,
  artists: [{ id: `a-${artist}`, name: artist }],
  album: null,
  images: [{ quality: '150x150', url: `https://img/${id}.jpg` }],
  audio: [{ quality: '160', url: `https://a/${id}.mp4` }],
  duration: 200,
  language: 'telugu',
  year: '2024',
  explicit: false,
  hasLyrics: false,
  playCount: null,
});

const set = (k: string, v: unknown) => localStorage.setItem(k, JSON.stringify(v));
const get = (k: string) => JSON.parse(localStorage.getItem(k) ?? 'null') as unknown;

function seedDevice(): void {
  set(KEYS.settings, { state: { theme: 'amoled', pinnedLanguages: ['telugu', 'hindi'], inferredRegion: { country: 'IN' } }, version: 3 });
  set(KEYS.library, {
    state: {
      favorites: [song('f1'), song('f2')],
      collections: [{ id: 'c1', name: 'Road trip', createdAt: 1, songs: [song('s1'), song('s2')], tags: ['Drive'] }],
      saved: [],
      hiddenSongIds: ['h1'],
      later: [song('l1')],
      hiddenArtists: [],
      trash: [],
    },
    version: 0,
  });
  set(KEYS.history, { state: { entries: [{ song: song('p1'), ts: 1_000, completed: true }, { song: song('p2'), ts: 2_000, completed: false }] }, version: 0 });
  set(KEYS.profile, { version: 1, createdAt: 1, updatedAt: 2, languages: { telugu: {} }, artists: {}, hourHistogram: [], totals: { plays: 9, completes: 1, skips: 0, favorites: 0, queueAdds: 0 }, recentSongIds: [], hourBuckets: {} });
  set(KEYS.search, { state: { recent: ['arr', 'ilayaraja'], pinned: ['arr'], songSort: 'relevance' }, version: 0 });
  set('vinax.search.workspace.v1', { state: { compact: true, presets: [{ id: 'p1', name: 'Telugu 90s', query: '90s', filters: {}, sort: 'relevance', language: 'telugu' }] }, version: 0 });
  set('vinax.bookmarks.v1', { state: { marks: { s1: [12, 80] } }, version: 0 });
  set('vinax.home.design.v1', { title: 'Evening', description: 'Calm', order: ['feed', 'quick'], hidden: ['charts'] });
  set(KEYS.userName, 'Vinay');
  set(KEYS.userHandle, 'vinay_k');
  set(KEYS.onboarded, true);
  set(KEYS.alarm, { state: { enabled: true, time: '06:30', action: 'favorites', collectionId: null, fadeIn: true, lastFired: '' }, version: 0 });
  set('vinax.streak.v1', { count: 4, lastDay: '2026-09-15', best: 9 });
  localStorage.setItem('vinax.aiReplyStyle', 'concise');
  // Things that must NOT travel:
  set(KEYS.signedDeviceId, 'abc.sig');
  set(KEYS.deviceId, 'uuid-1');
  set(KEYS.roomHostTokens, { r1: 'secret' });
  set(KEYS.downloads, { state: { items: { d1: { song: song('d1'), path: '/storage/emulated/0/x.mp3', addedAt: 1 } } }, version: 0 });
  set(KEYS.analyticsConsent, true);
  set(KEYS.player, { state: { queue: [song('q1')], index: 0 }, version: 1 });
}

beforeEach(() => {
  localStorage.clear();
  seedDevice();
});
afterEach(() => vi.restoreAllMocks());

describe('createBackup', () => {
  it('carries every portable category and none of the device-bound keys', () => {
    const file = createBackup();
    expect(file.format).toBe(BACKUP_FORMAT);
    expect(file.schemaVersion).toBe(BACKUP_SCHEMA_VERSION);
    expect(Object.keys(file.categories).sort()).toEqual(
      ['bookmarks', 'extras', 'history', 'homeLayout', 'identity', 'library', 'searches', 'settings', 'taste'].sort(),
    );
    const json = serializeBackup(file);
    for (const forbidden of ['abc.sig', 'uuid-1', 'secret', '/storage/emulated', KEYS.signedDeviceId, KEYS.roomHostTokens, KEYS.downloads, KEYS.analyticsConsent, KEYS.player]) {
      expect(json, forbidden).not.toContain(forbidden);
    }
    // The inferred region is device-bound and is stripped from settings.
    expect(json).not.toContain('inferredRegion');
    expect(file.categories.searches?.['vinax.search.workspace.v1']).toMatchObject({ state: { presets: [{ id: 'p1' }] } });
    expect(file.categories.bookmarks?.['vinax.bookmarks.v1']).toEqual({ state: { marks: { s1: [12, 80] } }, version: 0 });
  });

  it('every category key is documented and disjoint', () => {
    const seen = new Set<string>();
    for (const c of BACKUP_CATEGORIES) {
      expect(c.label).toBeTruthy();
      expect(c.description).toBeTruthy();
      for (const k of c.keys) {
        expect(seen.has(k.key), k.key).toBe(false);
        seen.add(k.key);
      }
    }
  });
});

describe('round trip', () => {
  it('a valid backup restores the same portable data on a wiped device', () => {
    const json = serializeBackup(createBackup());
    localStorage.clear();
    const parsed = parseBackup(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rejected).toEqual([]);
    expect(parsed.migratedFrom).toBeNull();
    const res = applyBackup(parsed, { mode: 'replace' });
    expect(res.ok).toBe(true);
    const lib = get(KEYS.library) as { state: { favorites: Song[]; collections: Array<{ tags?: string[] }> } };
    expect(lib.state.favorites.map((s) => s.id)).toEqual(['f1', 'f2']);
    expect(lib.state.collections[0].tags).toEqual(['drive']);
    expect((get(KEYS.history) as { state: { entries: unknown[] } }).state.entries).toHaveLength(2);
    expect((get('vinax.bookmarks.v1') as { state: { marks: Record<string, number[]> } }).state.marks.s1).toEqual([12, 80]);
    expect((get('vinax.search.workspace.v1') as { state: { presets: Array<{ name: string }> } }).state.presets[0].name).toBe('Telugu 90s');
    expect(get('vinax.home.design.v1')).toMatchObject({ hidden: ['charts'] });
    expect(get(KEYS.userName)).toBe('Vinay');
    expect(localStorage.getItem('vinax.aiReplyStyle')).toBe('concise');
    expect(get('vinax.streak.v1')).toEqual({ count: 4, lastDay: '2026-09-15', best: 9 });
    // Identity is a claim, not a fact: the username is re-confirmed, not written.
    expect(get(KEYS.userHandle)).toBeNull();
    expect(get(KEYS.userHandlePending)).toMatchObject({ username: 'vinay_k', status: 'pending' });
    expect(res.ok && res.pendingHandle).toBe('vinay_k');
    // Nothing device-bound came back.
    expect(get(KEYS.signedDeviceId)).toBeNull();
    expect(get(KEYS.downloads)).toBeNull();
    expect(backupMeta().lastImportMode).toBe('replace');
  });

  it('does not re-claim a username this device already holds', () => {
    const json = serializeBackup(createBackup());
    const parsed = parseBackup(json);
    if (!parsed.ok) throw new Error('parse');
    applyBackup(parsed, { mode: 'replace' });
    expect(get(KEYS.userHandle)).toBe('vinay_k');
    expect(get(KEYS.userHandlePending)).toBeNull();
  });
});

describe('legacy export migration', () => {
  it('imports the old flat "profile export" shape and drops what must not travel', () => {
    const legacy = {
      app: 'vinax',
      exportedAt: '2026-08-01T00:00:00.000Z',
      settings: { state: { theme: 'light', pinnedLanguages: ['tamil'] }, version: 3 },
      library: { state: { favorites: [song('old1')], collections: [], saved: [], hiddenSongIds: [], later: [], hiddenArtists: [] }, version: 0 },
      history: { state: { entries: [{ song: song('old2'), ts: 5, completed: false }] }, version: 0 },
      profile: { version: 1, totals: { plays: 1 }, languages: {}, artists: {}, hourHistogram: [], recentSongIds: [], hourBuckets: {} },
      signedDeviceId: 'leaked.sig',
      roomHostTokens: { r: 't' },
      downloads: { state: { items: {} }, version: 0 },
      userName: 'Old Me',
      userHandle: 'old_me',
      onboarded: true,
    };
    const parsed = parseBackup(JSON.stringify(legacy));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.migratedFrom).toBe('legacy-export');
    expect(parsed.warnings.join(' ')).toMatch(/left out/);
    expect(parsed.categories.map((c) => c.id).sort()).toEqual(['history', 'identity', 'library', 'settings', 'taste']);
    localStorage.clear();
    const res = applyBackup(parsed, { mode: 'replace' });
    expect(res.ok).toBe(true);
    expect((get(KEYS.library) as { state: { favorites: Song[] } }).state.favorites[0].id).toBe('old1');
    expect(get(KEYS.signedDeviceId)).toBeNull();
    expect(get(KEYS.roomHostTokens)).toBeNull();
    expect(get(KEYS.userHandlePending)).toMatchObject({ username: 'old_me' });
  });

  it('also accepts the pre-rename "tarang" export', () => {
    const parsed = parseBackup(JSON.stringify({ app: 'tarang', settings: { state: { theme: 'dark' }, version: 1 } }));
    expect(parsed.ok && parsed.migratedFrom).toBe('legacy-export');
  });
});

describe('malformed input leaves existing data intact', () => {
  const before = () => JSON.stringify(Object.fromEntries(Object.keys(localStorage).sort().map((k) => [k, localStorage.getItem(k)])));

  it('rejects non-JSON, non-backup and future-schema files', () => {
    const snap = before();
    expect(parseBackup('{not json')).toMatchObject({ ok: false, error: /valid JSON/ });
    expect(parseBackup('{"hello":"world"}')).toMatchObject({ ok: false, error: /not a VinaX backup/ });
    expect(parseBackup(JSON.stringify({ format: BACKUP_FORMAT, schemaVersion: 99, categories: {} }))).toMatchObject({ ok: false, error: /newer VinaX/ });
    expect(parseBackup('[]')).toMatchObject({ ok: false });
    expect(before()).toBe(snap);
  });

  it('a damaged category is reported and the whole restore is refused by importProfileJson', () => {
    const file = createBackup();
    (file.categories.library as Record<string, unknown>)[KEYS.library] = { state: { favorites: 'nope' } };
    const snap = before();
    const parsed = parseBackup(serializeBackup(file));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rejected).toEqual([{ id: 'library', label: 'Library', error: expect.stringMatching(/favorites/) }]);
    const out = importProfileJson(serializeBackup(file), { reload: false });
    expect(out.ok).toBe(false);
    expect(before()).toBe(snap);
  });

  it('drops individual junk songs instead of failing or storing them', () => {
    const file = createBackup();
    const lib = (file.categories.library as Record<string, { state: { favorites: unknown[] } }>)[KEYS.library];
    lib.state.favorites.push({ id: 'x' }, null, 'string', { title: 'no id' }, { id: 'ok', title: 'Fine', artists: 'bad' });
    const parsed = parseBackup(serializeBackup(file));
    if (!parsed.ok) throw new Error('parse');
    const favs = (parsed.categories.find((c) => c.id === 'library')!.values[KEYS.library] as { state: { favorites: Song[] } }).state.favorites;
    expect(favs.map((s) => s.id)).toEqual(['f1', 'f2', 'ok']);
    expect(favs[2].artists).toEqual([]);
  });

  it('nested identity values are checked before anything is written', () => {
    const file = createBackup();
    (file.categories.identity as Record<string, unknown>)[KEYS.userHandle] = 'Not A Handle!!';
    const parsed = parseBackup(serializeBackup(file));
    expect(parsed.ok && parsed.rejected[0]).toMatchObject({ id: 'identity', error: /invalid format/ });
  });
});

describe('storage failures', () => {
  it('a quota error mid-restore rolls every written key back and reports failure', () => {
    const json = serializeBackup(createBackup());
    const snap = JSON.stringify(Object.fromEntries(Object.keys(localStorage).sort().map((k) => [k, localStorage.getItem(k)])));
    const original = Storage.prototype.setItem;
    let writes = 0;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      writes += 1;
      if (writes === 3) {
        const err = new DOMException('quota', 'QuotaExceededError');
        throw err;
      }
      return original.call(this, k, v);
    });
    const parsed = parseBackup(json);
    if (!parsed.ok) throw new Error('parse');
    const res = applyBackup(parsed, { mode: 'replace' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe('quota');
    expect(res.rolledBack).toBe(true);
    vi.restoreAllMocks();
    const after = JSON.stringify(Object.fromEntries(Object.keys(localStorage).sort().map((k) => [k, localStorage.getItem(k)])));
    expect(after).toBe(snap);
    expect(backupMeta().lastImportAt).toBeUndefined();
  });

  it('importProfileJson never reports success when storage refused the write', () => {
    const json = serializeBackup(createBackup());
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    const out = importProfileJson(json, { reload: false });
    expect(out.ok).toBe(false);
    expect(!out.ok && out.error).toMatch(/out of storage/);
  });
});

describe('merge mode', () => {
  it('unions library, history, bookmarks and saved searches without duplicates', () => {
    const file = createBackup();
    localStorage.clear();
    set(KEYS.library, {
      state: {
        favorites: [song('f2'), song('mine')],
        collections: [{ id: 'c1', name: 'Road trip (edited)', createdAt: 1, songs: [song('s2'), song('s9')] }, { id: 'c2', name: 'Mine', createdAt: 2, songs: [] }],
        saved: [], hiddenSongIds: [], later: [], hiddenArtists: [], trash: [],
      },
      version: 0,
    });
    set(KEYS.history, { state: { entries: [{ song: song('p2'), ts: 2_000, completed: false }, { song: song('p3'), ts: 3_000, completed: true }] }, version: 0 });
    set('vinax.bookmarks.v1', { state: { marks: { s1: [13], s7: [5] } }, version: 0 });
    set('vinax.search.workspace.v1', { state: { compact: false, presets: [{ id: 'p2', name: 'Mine', query: 'q', filters: {}, sort: 'relevance', language: null }] }, version: 0 });
    const parsed = parseBackup(serializeBackup(file));
    if (!parsed.ok) throw new Error('parse');
    const res = applyBackup(parsed, { mode: 'merge', categories: ['library', 'history', 'bookmarks', 'searches'] });
    expect(res.ok).toBe(true);
    const lib = get(KEYS.library) as { state: { favorites: Song[]; collections: Array<{ id: string; name: string; songs: Song[] }> } };
    expect(lib.state.favorites.map((s) => s.id)).toEqual(['f2', 'mine', 'f1']);
    expect(lib.state.collections.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(lib.state.collections[0].name).toBe('Road trip (edited)');
    expect(lib.state.collections[0].songs.map((s) => s.id)).toEqual(['s2', 's9', 's1']);
    const hist = (get(KEYS.history) as { state: { entries: Array<{ song: Song }> } }).state.entries.map((e) => e.song.id);
    expect(hist).toEqual(['p3', 'p2', 'p1']);
    expect((get('vinax.bookmarks.v1') as { state: { marks: Record<string, number[]> } }).state.marks).toEqual({ s1: [13, 80], s7: [5] });
    const presets = (get('vinax.search.workspace.v1') as { state: { compact: boolean; presets: Array<{ id: string }> } }).state;
    expect(presets.presets.map((p) => p.id)).toEqual(['p2', 'p1']);
    expect(presets.compact).toBe(false);
  });
});

describe('device handoff payload', () => {
  it('carries identity keys that a plain backup never does, and restores them', () => {
    const payload = createTransferPayload();
    expect(payload.transfer[KEYS.signedDeviceId]).toBe('abc.sig');
    expect(payload.transfer[KEYS.userHandle]).toBe('vinay_k');
    expect(payload.transfer[KEYS.roomHostTokens]).toBeUndefined();
    const json = JSON.stringify(payload);
    localStorage.clear();
    const res = applyTransferPayload(json);
    expect(res.ok).toBe(true);
    expect(get(KEYS.signedDeviceId)).toBe('abc.sig');
    expect(get(KEYS.userHandle)).toBe('vinay_k');
    expect(get(KEYS.userHandlePending)).toBeNull();
    expect(get(KEYS.analyticsConsent)).toBe(true);
  });
});
