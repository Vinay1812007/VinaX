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
  MAX_BACKUP_BYTES,
  RESTORE_UNDO_KEY,
  applyBackup,
  applyTransferPayload,
  backupMeta,
  createBackup,
  createTransferPayload,
  keepUndo,
  parseBackup,
  readUndo,
  restoreWithUndo,
  serializeBackup,
  storeVersion,
  type BackupCategoryId,
  type BackupFile,
  type ParsedBackup,
} from './backup';
import { importProfileJson, readBackupFile } from './actions';

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
  sessionStorage.clear();
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

// ---------------------------------------------------------------------------
// Audit regressions
// ---------------------------------------------------------------------------
const fileWith = (categories: BackupFile['categories']): string =>
  JSON.stringify({ format: BACKUP_FORMAT, schemaVersion: BACKUP_SCHEMA_VERSION, app: 'vinax', appVersion: 'test', exportedAt: '2026-09-01T00:00:00.000Z', categories });
const parseOk = (json: string): ParsedBackup => {
  const parsed = parseBackup(json);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed;
};
const valuesOf = (parsed: ParsedBackup, id: BackupCategoryId) => parsed.categories.find((c) => c.id === id)?.values ?? {};
const snapshotAll = () => JSON.stringify(Object.fromEntries(Object.keys(localStorage).sort().map((k) => [k, localStorage.getItem(k)])));

describe('history keeps measured listening time and skip marks', () => {
  type Entries = { state: { entries: Array<{ song: Song; ts: number; completed: boolean; listenedSec?: number; skipped?: boolean }> } };

  it('round-trips listenedSec (finite, >= 0, capped at six hours) and a boolean skipped', () => {
    set(KEYS.history, {
      state: {
        entries: [
          { song: song('a'), ts: 9, completed: true, listenedSec: 187.4 },
          { song: song('b'), ts: 8, completed: false, listenedSec: 12, skipped: true },
          { song: song('c'), ts: 7, completed: false, listenedSec: 99_999, skipped: false },
          { song: song('d'), ts: 6, completed: false, listenedSec: -4, skipped: 'yes' },
          { song: song('e'), ts: 5, completed: false, listenedSec: 'NaN' },
        ],
      },
      version: 0,
    });
    const json = serializeBackup(createBackup(['history']));
    localStorage.clear();
    expect(applyBackup(parseOk(json), { mode: 'replace' }).ok).toBe(true);
    expect((get(KEYS.history) as Entries).state.entries).toEqual([
      { song: song('a'), ts: 9, completed: true, listenedSec: 187.4 },
      { song: song('b'), ts: 8, completed: false, listenedSec: 12, skipped: true },
      { song: song('c'), ts: 7, completed: false, listenedSec: 21_600, skipped: false },
      { song: song('d'), ts: 6, completed: false },
      { song: song('e'), ts: 5, completed: false },
    ]);
  });

  it('merging the same play keeps one entry with the larger measured time', () => {
    const json = fileWith({
      history: { [KEYS.history]: { state: { entries: [{ song: song('p2'), ts: 2_000, completed: true, listenedSec: 200 }, { song: song('new'), ts: 3_000, completed: false, listenedSec: 5, skipped: true }] }, version: 0 } },
    });
    set(KEYS.history, { state: { entries: [{ song: song('p2'), ts: 2_000, completed: false, listenedSec: 40, skipped: true }] }, version: 0 });
    expect(applyBackup(parseOk(json), { mode: 'merge' }).ok).toBe(true);
    expect((get(KEYS.history) as Entries).state.entries).toEqual([
      { song: song('new'), ts: 3_000, completed: false, listenedSec: 5, skipped: true },
      { song: song('p2'), ts: 2_000, completed: true, listenedSec: 200 },
    ]);
  });
});

describe('validated import keeps wrong types out', () => {
  it('settings: only known keys of the right type, and a pre-7.0 record gets its discovery mode', () => {
    const json = fileWith({
      settings: {
        [KEYS.settings]: {
          state: {
            theme: 'neon', accent: 'ocean', crossfade: 'yes', crossfadeSeconds: 'NaN', glassLevel: 900, eqGains: { 0: 1 }, pinnedLanguages: ['telugu', 7, null],
            mutedLanguages: 'hindi', exploreMode: true, setTheme: 'not a function', __proto__pollution: 1, autoqueueSimilar: true, accentCustom: 42, manualCountry: 'IN',
          },
          version: 3,
        },
      },
    });
    const state = (valuesOf(parseOk(json), 'settings')[KEYS.settings] as { state: Record<string, unknown>; version: number });
    expect(state.state).toEqual({ accent: 'ocean', glassLevel: 100, pinnedLanguages: ['telugu'], exploreMode: true, discoveryMode: 'discover', manualCountry: 'IN' });
    // An older file keeps its version so the store's migrate still runs; a newer one is clamped.
    expect(state.version).toBe(3);
    const newer = fileWith({ settings: { [KEYS.settings]: { state: { theme: 'light', discoveryMode: 'familiar', exploreMode: true }, version: 99 } } });
    const env = valuesOf(parseOk(newer), 'settings')[KEYS.settings] as { state: Record<string, unknown>; version: number };
    expect(env.version).toBe(storeVersion(KEYS.settings));
    expect(env.state.discoveryMode).toBe('familiar');
  });

  it('every other envelope is written with the running store\'s version, never the file\'s', () => {
    const file = createBackup();
    for (const values of Object.values(file.categories)) {
      for (const v of Object.values(values ?? {})) {
        if (v && typeof v === 'object' && 'version' in v && 'state' in v) (v as { version: number }).version = 42;
      }
    }
    localStorage.clear();
    expect(applyBackup(parseOk(serializeBackup(file)), { mode: 'replace' }).ok).toBe(true);
    for (const key of [KEYS.library, KEYS.history, KEYS.search, 'vinax.search.workspace.v1', 'vinax.bookmarks.v1', KEYS.alarm]) {
      expect((get(key) as { version: number }).version, key).toBe(storeVersion(key));
    }
    expect((get(KEYS.settings) as { version: number }).version).toBe(storeVersion(KEYS.settings));
  });

  it('taste profile is normalised', () => {
    const json = fileWith({ taste: { [KEYS.profile]: { version: 1, languages: [], artists: 'x', hourHistogram: null, totals: { plays: '9' }, recentSongIds: [1, 's'], hourBuckets: null } } });
    expect(valuesOf(parseOk(json), 'taste')[KEYS.profile]).toMatchObject({
      version: 1, languages: {}, artists: {}, hourBuckets: {}, recentSongIds: ['s'], totals: { plays: 0, completes: 0, skips: 0, favorites: 0, queueAdds: 0 },
    });
    expect((valuesOf(parseOk(json), 'taste')[KEYS.profile] as { hourHistogram: number[] }).hourHistogram).toHaveLength(24);
  });

  it('trashed playlists get the same cleaning as live ones', () => {
    const now = Date.now();
    const json = fileWith({
      library: {
        [KEYS.library]: {
          state: {
            favorites: [],
            trash: [
              { collection: { id: 't1', name: 'Gone', createdAt: 1, songs: [song('x'), { id: 'junk' }] }, deletedAt: now - 1000 },
              { collection: { id: 't2', name: 'No songs', songs: 'nope' }, deletedAt: now - 1000 },
              { collection: { id: 't3' }, deletedAt: now - 1000 },
              { collection: { id: 't4', name: 'Bad date', songs: [] }, deletedAt: 'yesterday' },
            ],
          },
          version: 0,
        },
      },
    });
    const trash = (valuesOf(parseOk(json), 'library')[KEYS.library] as { state: { trash: Array<{ collection: { id: string; songs: Song[] } }> } }).state.trash;
    expect(trash.map((t) => [t.collection.id, t.collection.songs.map((x) => x.id)])).toEqual([['t1', ['x']], ['t2', []]]);
  });

  it('alarm, lyric offsets and media URLs are validated', () => {
    const bad = { ...song('u1'), audio: [{ quality: '160', url: 'javascript:alert(1)' }, { quality: '320', url: 'HTTPS://cdn/x.mp4' }, { quality: '96', url: 'file:///etc/passwd' }], images: [{ quality: '500', url: `https://img/${'a'.repeat(2100)}` }, { quality: '150', url: 'data:image/png;base64,AAAA' }, { quality: '50', url: 'http://img/ok.jpg' }] };
    const json = fileWith({
      library: { [KEYS.library]: { state: { favorites: [bad], saved: [{ id: 'al1', kind: 'album', title: 'Album', image: 'javascript:void(0)' }, { id: 'al2', kind: 'album', title: 'Album 2', image: 'https://img/a.jpg' }] }, version: 0 } },
      extras: {
        [KEYS.alarm]: { state: { enabled: 'true', time: '7am', action: 'explode', collectionId: 5, fadeIn: false, lastFired: 12 }, version: 0 },
        [KEYS.lyricsOffset]: { state: { offsets: { a: 0.5, b: 400, c: -400, d: 'x', e: NaN, f: 0 } }, version: 0 },
      },
    });
    const parsed = parseOk(json);
    const lib = (valuesOf(parsed, 'library')[KEYS.library] as { state: { favorites: Song[]; saved: Array<{ id: string; image: string | null }> } }).state;
    expect(lib.favorites[0].audio).toEqual([{ quality: '320', url: 'HTTPS://cdn/x.mp4' }]);
    expect(lib.favorites[0].images).toEqual([{ quality: '50', url: 'http://img/ok.jpg' }]);
    expect(lib.saved.map((e) => e.image)).toEqual([null, 'https://img/a.jpg']);
    expect((valuesOf(parsed, 'extras')[KEYS.alarm] as { state: unknown }).state).toEqual({ enabled: false, time: '07:00', action: 'favorites', collectionId: null, fadeIn: false, lastFired: '' });
    expect((valuesOf(parsed, 'extras')[KEYS.lyricsOffset] as { state: unknown }).state).toEqual({ offsets: { a: 0.5, b: 10, c: -10 } });
    const valid = fileWith({ extras: { [KEYS.alarm]: { state: { enabled: true, time: '23:59', action: 'collection', collectionId: 'c1', fadeIn: true, lastFired: '2026-09-01' }, version: 0 } } });
    expect((valuesOf(parseOk(valid), 'extras')[KEYS.alarm] as { state: unknown }).state).toEqual({ enabled: true, time: '23:59', action: 'collection', collectionId: 'c1', fadeIn: true, lastFired: '2026-09-01' });
    const late = fileWith({ extras: { [KEYS.alarm]: { state: { time: '24:61' }, version: 0 } } });
    expect((valuesOf(parseOk(late), 'extras')[KEYS.alarm] as { state: { time: string } }).state.time).toBe('07:00');
  });
});

describe('merge mode for the categories that used to be replaced', () => {
  it('extras: streak, offsets, karaoke, prompts, sidebar groups and the alarm', () => {
    const json = fileWith({
      extras: {
        [KEYS.alarm]: { state: { enabled: false, time: '09:00', action: 'resume', collectionId: null, fadeIn: true, lastFired: '' }, version: 0 },
        [KEYS.lyricsOffset]: { state: { offsets: { s1: 2, s2: -1 } }, version: 0 },
        [KEYS.karaoke]: [{ song: song('k1'), at: 50 }, { song: song('k2'), at: 10 }],
        'vinax.streak.v1': { count: 2, lastDay: '2026-09-16', best: 30 },
        'vinax.nav.groups.v1': ['Explore', 'Library'],
        'vinax.aiPrompts': [{ id: 'p1', title: 'One', text: 'one', createdAt: 1 }, { id: 'p2', title: 'Two', text: 'two', createdAt: 2 }],
        'vinax.aiReplyStyle': 'detailed',
      },
    });
    set(KEYS.lyricsOffset, { state: { offsets: { s1: -3, s9: 1 } }, version: 0 });
    set(KEYS.karaoke, [{ song: song('k1'), at: 90 }, { song: song('k3'), at: 20 }]);
    set('vinax.nav.groups.v1', ['Library', 'You']);
    set('vinax.aiPrompts', [{ id: 'p2', title: 'Two (mine)', text: 'two', createdAt: 5 }, { id: 'p3', title: 'Three', text: 'three', createdAt: 6 }]);
    expect(applyBackup(parseOk(json), { mode: 'merge', categories: ['extras'] }).ok).toBe(true);
    // The alarm on this device is kept as-is.
    expect((get(KEYS.alarm) as { state: { time: string; enabled: boolean } }).state).toMatchObject({ time: '06:30', enabled: true });
    expect((get(KEYS.lyricsOffset) as { state: { offsets: Record<string, number> } }).state.offsets).toEqual({ s1: -3, s2: -1, s9: 1 });
    expect((get(KEYS.karaoke) as Array<{ song: Song; at: number }>).map((k) => [k.song.id, k.at])).toEqual([['k1', 90], ['k3', 20], ['k2', 10]]);
    // Device streak (4, 2026-09-15, best 9) vs file (2, 2026-09-16, best 30): later day wins, best is the max.
    expect(get('vinax.streak.v1')).toEqual({ count: 2, lastDay: '2026-09-16', best: 30 });
    expect(get('vinax.nav.groups.v1')).toEqual(['Library', 'You', 'Explore']);
    expect((get('vinax.aiPrompts') as Array<{ id: string; title: string }>).map((p) => [p.id, p.title])).toEqual([['p2', 'Two (mine)'], ['p3', 'Three'], ['p1', 'One']]);
    expect(localStorage.getItem('vinax.aiReplyStyle')).toBe('detailed');
  });

  it('streak: an older file never rolls the device back, and lists are capped', () => {
    const json = fileWith({ extras: { 'vinax.streak.v1': { count: 50, lastDay: '2026-01-01', best: 50 }, 'vinax.nav.groups.v1': Array.from({ length: 50 }, (_, i) => `g${i}`) } });
    set('vinax.nav.groups.v1', ['mine']);
    applyBackup(parseOk(json), { mode: 'merge' });
    expect(get('vinax.streak.v1')).toEqual({ count: 4, lastDay: '2026-09-15', best: 50 });
    const groups = get('vinax.nav.groups.v1') as string[];
    expect(groups).toHaveLength(50);
    expect(groups[0]).toBe('mine');
  });

  it('taste: the profile that learned from more plays is kept; home layout stays as it is here', () => {
    const profile = (plays: number) => ({ version: 1, totals: { plays }, languages: {}, artists: {}, hourHistogram: [], recentSongIds: [], hourBuckets: {} });
    const json = fileWith({
      taste: { [KEYS.profile]: profile(3), [KEYS.profileKid]: profile(20) },
      homeLayout: { 'vinax.home.design.v1': { title: 'From file', description: 'x', order: ['charts'], hidden: [] } },
    });
    set(KEYS.profileKid, profile(5));
    applyBackup(parseOk(json), { mode: 'merge' });
    expect((get(KEYS.profile) as { totals: { plays: number } }).totals.plays).toBe(9);
    expect((get(KEYS.profileKid) as { totals: { plays: number } }).totals.plays).toBe(20);
    expect((get('vinax.home.design.v1') as { title: string }).title).toBe('Evening');
    // …and with nothing on the device the file's values land.
    localStorage.clear();
    applyBackup(parseOk(json), { mode: 'merge' });
    expect((get(KEYS.profile) as { totals: { plays: number } }).totals.plays).toBe(3);
    expect((get('vinax.home.design.v1') as { title: string }).title).toBe('From file');
  });
});

describe('size caps', () => {
  const many = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => song(`${prefix}${i}`));

  it('a merge never trims what is already on this device', () => {
    set(KEYS.library, { state: { favorites: [], collections: [], saved: [], hiddenSongIds: [], later: [], hiddenArtists: Array.from({ length: 620 }, (_, i) => `artist ${i}`), trash: [] }, version: 0 });
    set('vinax.aiPrompts', Array.from({ length: 58 }, (_, i) => ({ id: `d${i}`, title: `t${i}`, text: `text ${i}`, createdAt: i })));
    const json = fileWith({
      library: { [KEYS.library]: { state: { favorites: [song('f9')], hiddenArtists: ['from file'] }, version: 0 } },
      extras: { 'vinax.aiPrompts': [{ id: 'fromFile', title: 'f', text: 'from file', createdAt: 1 }] },
    });
    applyBackup(parseOk(json), { mode: 'merge' });
    const lib = (get(KEYS.library) as { state: { favorites: Song[]; hiddenArtists: string[] } }).state;
    expect(lib.favorites.map((x) => x.id)).toEqual(['f9']);
    // 620 never-play artists is over the import cap of 500 — every one of them stays.
    expect(lib.hiddenArtists).toHaveLength(620);
    expect(lib.hiddenArtists[619]).toBe('artist 619');
    // 58 saved prompts on the device is over the import cap of 50 — all 58 stay.
    const prompts = get('vinax.aiPrompts') as Array<{ id: string }>;
    expect(prompts).toHaveLength(58);
    expect(prompts.every((x) => x.id.startsWith('d'))).toBe(true);
  });

  it('warns in the preview when a cap cut the file short', () => {
    const json = fileWith({
      history: { [KEYS.history]: { state: { entries: many(170, 'h').map((x, i) => ({ song: x, ts: 10_000 - i, completed: true })) }, version: 0 } },
      library: { [KEYS.library]: { state: { later: many(510, 'l') }, version: 0 } },
    });
    const parsed = parseOk(json);
    expect(parsed.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/Listening history: the file holds 170, only the first 150/), expect.stringMatching(/Listen Later: the file holds 510, only the first 500/)]));
    expect((valuesOf(parsed, 'history')[KEYS.history] as { state: { entries: unknown[] } }).state.entries).toHaveLength(150);
    expect(parseOk(serializeBackup(createBackup())).warnings).toEqual([]);
  });
});

describe('undo snapshot', () => {
  it('captures the pending-username key when identity is restored', () => {
    set(KEYS.userHandlePending, { username: 'before', status: 'pending' });
    expect(keepUndo(['identity'])).toBe(true);
    const keys = readUndo()?.entries.map(([k]) => k) ?? [];
    expect(keys).toContain(KEYS.userHandlePending);
    expect(readUndo()?.entries.find(([k]) => k === KEYS.userHandlePending)?.[1]).toBe(JSON.stringify({ username: 'before', status: 'pending' }));
    keepUndo(['history']);
    expect(readUndo()?.entries.map(([k]) => k)).toEqual([KEYS.history]);
  });

  it('a failed restore puts the earlier snapshot back instead of losing it', () => {
    const earlier = JSON.stringify({ at: 1, entries: [[KEYS.history, 'earlier']] });
    sessionStorage.setItem(RESTORE_UNDO_KEY, earlier);
    const parsed = parseOk(serializeBackup(createBackup()));
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (this === localStorage) throw new DOMException('quota', 'QuotaExceededError');
      return original.call(this, k, v);
    });
    const res = restoreWithUndo(parsed, { mode: 'replace' });
    expect(res.ok).toBe(false);
    expect(res.undoKept).toBe(false);
    vi.restoreAllMocks();
    expect(sessionStorage.getItem(RESTORE_UNDO_KEY)).toBe(earlier);
  });

  it('when the new snapshot cannot be kept, the stale one is removed and the restore still applies', () => {
    sessionStorage.setItem(RESTORE_UNDO_KEY, JSON.stringify({ at: 1, entries: [[KEYS.history, 'stale']] }));
    const parsed = parseOk(serializeBackup(createBackup()));
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (this === sessionStorage) throw new DOMException('quota', 'QuotaExceededError');
      return original.call(this, k, v);
    });
    const res = restoreWithUndo(parsed, { mode: 'replace' });
    vi.restoreAllMocks();
    expect(res.ok).toBe(true);
    expect(res.undoKept).toBe(false);
    expect(sessionStorage.getItem(RESTORE_UNDO_KEY)).toBeNull();
  });

  it('the quick restore takes a snapshot too, and undoing it brings the old data back', () => {
    const json = fileWith({ history: { [KEYS.history]: { state: { entries: [] }, version: 0 } } });
    const before = localStorage.getItem(KEYS.history);
    expect(importProfileJson(json, { reload: false }).ok).toBe(true);
    expect((get(KEYS.history) as { state: { entries: unknown[] } }).state.entries).toEqual([]);
    expect(readUndo()?.entries).toEqual([[KEYS.history, before]]);
  });
});

describe('device handoff is one atomic write', () => {
  it('a storage failure on an identity key rolls the backup back as well', () => {
    const json = JSON.stringify(createTransferPayload());
    localStorage.clear();
    set(KEYS.library, { state: { favorites: [song('keep')] }, version: 0 });
    const snap = snapshotAll();
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (k === KEYS.signedDeviceId) throw new DOMException('quota', 'QuotaExceededError');
      return original.call(this, k, v);
    });
    const res = applyTransferPayload(json);
    vi.restoreAllMocks();
    expect(res.ok).toBe(false);
    expect(snapshotAll()).toBe(snap);
  });

  it('extraEntries ride in the same batch as the categories', () => {
    const parsed = parseOk(serializeBackup(createBackup(['history'])));
    const res = applyBackup(parsed, { mode: 'replace', extraEntries: [['vinax.extra', '"x"'], [KEYS.userName, null]] });
    expect(res.ok && res.keysWritten).toBe(3);
    expect(get('vinax.extra')).toBe('x');
    expect(localStorage.getItem(KEYS.userName)).toBeNull();
  });
});

describe('readBackupFile', () => {
  it('refuses an oversized file without reading it, and reports a read failure', async () => {
    const text = vi.fn(async () => '{}');
    const big = { size: MAX_BACKUP_BYTES + 1, text } as unknown as File;
    expect(await readBackupFile(big)).toEqual({ ok: false, error: expect.stringMatching(/8 MB/) });
    expect(text).not.toHaveBeenCalled();
    const broken = { size: 10, text: async () => Promise.reject(new Error('NotReadableError')) } as unknown as File;
    expect(await readBackupFile(broken)).toEqual({ ok: false, error: 'This file could not be read.' });
    expect(await readBackupFile({ size: 2, text } as unknown as File)).toEqual({ ok: true, text: '{}' });
  });
});
