// @vitest-environment jsdom
/**
 * The tarang.* → vinax.* rename runs at import time, so every case seeds
 * localStorage, resets the module registry and imports the module fresh.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const run = async (): Promise<void> => {
  vi.resetModules();
  await import('./earlyMigrations');
};

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('earlyMigrations', () => {
  it('moves every old-prefix key and leaves other keys alone', async () => {
    localStorage.setItem('tarang.library.v1', '{"a":1}');
    localStorage.setItem('tarang.settings.v1', '{"b":2}');
    localStorage.setItem('other.key', 'x');
    await run();
    expect(localStorage.getItem('vinax.library.v1')).toBe('{"a":1}');
    expect(localStorage.getItem('vinax.settings.v1')).toBe('{"b":2}');
    expect(localStorage.getItem('tarang.library.v1')).toBeNull();
    expect(localStorage.getItem('tarang.settings.v1')).toBeNull();
    expect(localStorage.getItem('other.key')).toBe('x');
  });

  it('is idempotent', async () => {
    localStorage.setItem('tarang.history.v1', 'h');
    await run();
    await run();
    expect(localStorage.getItem('vinax.history.v1')).toBe('h');
    expect(localStorage.length).toBe(1);
  });

  it('keeps the old key when the new one already exists with different content', async () => {
    localStorage.setItem('tarang.library.v1', 'old library');
    localStorage.setItem('vinax.library.v1', 'new library');
    localStorage.setItem('tarang.search.v1', 'same');
    localStorage.setItem('vinax.search.v1', 'same');
    await run();
    expect(localStorage.getItem('vinax.library.v1')).toBe('new library');
    expect(localStorage.getItem('tarang.library.v1')).toBe('old library');
    // An identical copy is just cleaned up.
    expect(localStorage.getItem('tarang.search.v1')).toBeNull();
  });

  it('puts the old key back when the write is refused, and still migrates the others', async () => {
    localStorage.setItem('tarang.library.v1', 'big');
    localStorage.setItem('tarang.alarm.v1', 'small');
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (k === 'vinax.library.v1') throw new DOMException('full', 'QuotaExceededError');
      return original.call(this, k, v);
    });
    await run();
    expect(localStorage.getItem('tarang.library.v1')).toBe('big');
    expect(localStorage.getItem('vinax.library.v1')).toBeNull();
    expect(localStorage.getItem('vinax.alarm.v1')).toBe('small');
    expect(localStorage.getItem('tarang.alarm.v1')).toBeNull();
  });

  it('one unreadable key does not strand the rest', async () => {
    localStorage.setItem('tarang.a', '1');
    localStorage.setItem('tarang.b', '2');
    const original = Storage.prototype.getItem;
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, k: string) {
      if (k === 'tarang.a') throw new Error('unreadable');
      return original.call(this, k);
    });
    await run();
    vi.restoreAllMocks();
    expect(localStorage.getItem('tarang.a')).toBe('1');
    expect(localStorage.getItem('vinax.b')).toBe('2');
  });
});
