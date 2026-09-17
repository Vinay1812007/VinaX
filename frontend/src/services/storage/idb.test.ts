// @vitest-environment jsdom
/**
 * Connection lifecycle only (jsdom has no IndexedDB, so `open` is a stub):
 * a failed open is retried instead of cached, and a versionchange closes the
 * connection and reopens on the next call.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeDb {
  close: ReturnType<typeof vi.fn>;
  onversionchange: (() => void) | null;
  onclose: (() => void) | null;
  transaction(): { objectStore(): { count(): FakeRequest<number> } };
}
interface FakeRequest<T> {
  result: T;
  error: Error | null;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  onupgradeneeded?: (() => void) | null;
}

const request = <T,>(result: T, error: Error | null = null): FakeRequest<T> => {
  const req: FakeRequest<T> = { result, error, onsuccess: null, onerror: null };
  queueMicrotask(() => (error ? req.onerror?.() : req.onsuccess?.()));
  return req;
};
const fakeDb = (count: number): FakeDb => ({
  close: vi.fn(),
  onversionchange: null,
  onclose: null,
  transaction: () => ({ objectStore: () => ({ count: () => request(count) }) }),
});

let open: ReturnType<typeof vi.fn>;
const load = async () => {
  vi.resetModules();
  return import('./idb');
};

beforeEach(() => {
  open = vi.fn();
  Object.defineProperty(window, 'indexedDB', { configurable: true, value: { open } });
});

describe('idb connection', () => {
  it('does not cache a rejected open', async () => {
    open.mockImplementationOnce(() => request(null, new Error('blocked'))).mockImplementationOnce(() => request(fakeDb(7)));
    const idb = await load();
    expect(await idb.eventCount()).toBe(0); // first open failed → safe fallback
    expect(await idb.eventCount()).toBe(7); // …and the next call opened again
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('reuses one connection, and reopens after a versionchange closes it', async () => {
    const first = fakeDb(1);
    open.mockImplementationOnce(() => request(first)).mockImplementationOnce(() => request(fakeDb(2)));
    const idb = await load();
    expect(await idb.eventCount()).toBe(1);
    expect(await idb.eventCount()).toBe(1);
    expect(open).toHaveBeenCalledTimes(1);
    first.onversionchange?.();
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(await idb.eventCount()).toBe(2);
    expect(open).toHaveBeenCalledTimes(2);
  });
});
