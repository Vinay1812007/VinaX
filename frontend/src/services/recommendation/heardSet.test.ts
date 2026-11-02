// @vitest-environment jsdom
/**
 * The lifetime heard-set: what it keeps, where, and for how long (forever).
 * jsdom has no IndexedDB, so a small in-memory stand-in plays the browser's
 * part; it implements only the calls the heard-set makes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSong } from '@/__fixtures__/songs';
import { emitPlaybackEvent } from '@/services/playback/session';
import { heardCheck } from './admission';
import {
  HEARD_BACKFILL_KEY,
  HEARD_DB_NAME,
  HEARD_IMPORT_KEY,
  eraseHeardSet,
  exportHeardKeys,
  flushHeard,
  hasHeard,
  hasHeardKey,
  heardCount,
  idbBackend,
  initHeardSet,
  memoryBackend,
  recordHeard,
  recordHeardKeys,
  resetHeardSetForTests,
} from './heardSet';

interface FakeRequest {
  result: unknown;
  error: unknown;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  onupgradeneeded?: (() => void) | null;
  onblocked?: (() => void) | null;
}

function fakeIndexedDB(): { factory: IDBFactory; databases: Map<string, Map<string, Map<IDBValidKey, unknown>>> } {
  const databases = new Map<string, Map<string, Map<IDBValidKey, unknown>>>();
  const request = (fn: () => unknown): FakeRequest => {
    const r: FakeRequest = { result: undefined, error: null, onsuccess: null, onerror: null };
    queueMicrotask(() => {
      try {
        r.result = fn();
        r.onsuccess?.();
      } catch (e) {
        r.error = e;
        r.onerror?.();
      }
    });
    return r;
  };
  const factory = {
    open(name: string) {
      const r: FakeRequest = { result: undefined, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
      queueMicrotask(() => {
        let stores = databases.get(name);
        const fresh = !stores;
        if (!stores) {
          stores = new Map();
          databases.set(name, stores);
        }
        const s = stores;
        r.result = {
          objectStoreNames: { contains: (n: string) => s.has(n) },
          createObjectStore: (n: string) => s.set(n, new Map()),
          transaction: (n: string) => {
            const rows = s.get(n)!;
            const tx = {
              oncomplete: null as (() => void) | null,
              onerror: null,
              onabort: null,
              error: null,
              objectStore: () => ({
                getAllKeys: () => request(() => [...rows.keys()]),
                put: (v: unknown, k: IDBValidKey) => request(() => rows.set(k, v)),
                clear: () => request(() => rows.clear()),
              }),
            };
            setTimeout(() => tx.oncomplete?.(), 0);
            return tx;
          },
          close: () => undefined,
          onversionchange: null,
        };
        if (fresh) r.onupgradeneeded?.();
        r.onsuccess?.();
      });
      return r;
    },
    deleteDatabase(name: string) {
      return request(() => databases.delete(name));
    },
  };
  return { factory: factory as unknown as IDBFactory, databases };
}

const song = (id: string, title: string, artist = 'Anirudh') => makeSong(id, { title, artist });

beforeEach(() => {
  resetHeardSetForTests();
  localStorage.clear();
});
afterEach(() => resetHeardSetForTests());

describe('heard-set persistence', () => {
  it('keeps every heard song across a reload, in its own database', async () => {
    const { factory, databases } = fakeIndexedDB();
    await initHeardSet({ backend: idbBackend(factory)!, backfill: null, listen: false });
    recordHeard(song('a', 'Monica'));
    recordHeard(song('b', 'Hukum'));
    await flushHeard();
    expect([...databases.keys()]).toEqual([HEARD_DB_NAME]);

    // A new page: nothing in memory, the same database.
    resetHeardSetForTests();
    expect(hasHeard(song('a', 'Monica'))).toBe(false);
    await initHeardSet({ backend: idbBackend(factory)!, backfill: null, listen: false });
    expect(hasHeard(song('a', 'Monica'))).toBe(true);
    expect(hasHeard(song('b', 'Hukum'))).toBe(true);
    expect(hasHeard(song('c', 'Never Played'))).toBe(false);
    expect(heardCount()).toBe(2);
  });

  it('counts another version of a heard song as heard', async () => {
    await initHeardSet({ backend: memoryBackend(), backfill: null, listen: false });
    recordHeard(song('a', 'Monica'));
    expect(hasHeard(song('r', 'Monica (DJ Remix)'))).toBe(true);
    expect(hasHeard(song('m', 'Monica (Remastered)'))).toBe(true);
    expect(hasHeard(song('l', 'Monica - Live'))).toBe(true);
  });

  it('records the song of every counted PLAY on the playback bus', async () => {
    await initHeardSet({ backend: memoryBackend(), backfill: null });
    const s = song('p', 'Played Once');
    await vi.waitFor(() => {
      emitPlaybackEvent({ kind: 'counted', instanceId: 'i1', song: s, heardSec: 5 });
      expect(hasHeard(s)).toBe(true);
    });
  });

  it('has no row cap: the filter grows past its first size and forgets nothing', async () => {
    const backend = memoryBackend();
    await initHeardSet({ backend, backfill: null, listen: false });
    const keys = Array.from({ length: 9_000 }, (_, i) => `track ${i}|singer ${i % 31}`);
    recordHeardKeys(keys.slice(0, 4_500));
    await flushHeard();
    recordHeardKeys(keys.slice(4_500));
    expect(keys.every(hasHeardKey)).toBe(true);
    // Every key reaches the store, including any the filter already answered "heard" for.
    expect((await exportHeardKeys()).length).toBe(9_000);
    resetHeardSetForTests();
    await initHeardSet({ backend, backfill: null, listen: false });
    expect(heardCount()).toBe(9_000);
    expect(keys.every(hasHeardKey)).toBe(true);
  });

  it('registers its lookup for the admission gate once loaded', async () => {
    expect(heardCheck()).toBeUndefined();
    await initHeardSet({ backend: memoryBackend(), backfill: null, listen: false });
    recordHeard(song('a', 'Monica'));
    expect(heardCheck()?.('monica|anirudh')).toBe(true);
  });
});

describe('restore, backfill and erase', () => {
  it('adds a restored file’s songs on the next load and removes the import key', async () => {
    localStorage.setItem(HEARD_IMPORT_KEY, JSON.stringify({ v: 1, keys: ['old song|old singer', 42, ''] }));
    await initHeardSet({ backend: memoryBackend(), backfill: null, listen: false });
    expect(hasHeardKey('old song|old singer')).toBe(true);
    expect(localStorage.getItem(HEARD_IMPORT_KEY)).toBeNull();
  });

  it('reads the listening history into the set once, the first time', async () => {
    const plays = vi.fn(async () => [{ title: 'From History', artist: 'Sid Sriram' }]);
    const backend = memoryBackend();
    await initHeardSet({ backend, backfill: { plays }, listen: false });
    expect(hasHeard(song('h', 'From History', 'Sid Sriram'))).toBe(true);
    expect(localStorage.getItem(HEARD_BACKFILL_KEY)).not.toBeNull();
    resetHeardSetForTests();
    await initHeardSet({ backend, backfill: { plays }, listen: false });
    expect(plays).toHaveBeenCalledTimes(1);
    expect(hasHeard(song('h', 'From History', 'Sid Sriram'))).toBe(true);
  });

  it('"Erase everything" forgets every song and deletes the database', async () => {
    const { factory, databases } = fakeIndexedDB();
    await initHeardSet({ backend: idbBackend(factory)!, backfill: null, listen: false });
    recordHeard(song('a', 'Monica'));
    await flushHeard();
    await eraseHeardSet(factory);
    expect(hasHeard(song('a', 'Monica'))).toBe(false);
    expect(heardCount()).toBe(0);
    expect(databases.has(HEARD_DB_NAME)).toBe(false);
  });

  it('names the same import key as the backup file', async () => {
    const backup = await import('@/features/settings/backup');
    expect(backup.HEARD_IMPORT_KEY).toBe(HEARD_IMPORT_KEY);
  });

  it('works without IndexedDB, in memory', () => {
    expect(idbBackend(undefined)).toBeNull();
  });
});
