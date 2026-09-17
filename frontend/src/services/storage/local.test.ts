// @vitest-environment jsdom
/**
 * Guarded storage: the restore write-freeze, quota handling that never
 * throws into a store `set`, and the reference-deduped persist storage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useToastStore } from '@/store/toastStore';
import {
  createDedupedStorage,
  freezeLocalWrites,
  getLocal,
  guardedLocalStorage,
  localWritesFrozen,
  removeLocal,
  resetLocalGuardsForTests,
  setLocal,
  writeLocalBatch,
} from './local';

beforeEach(() => {
  localStorage.clear();
  resetLocalGuardsForTests();
  useToastStore.setState({ toasts: [] });
});
afterEach(() => vi.restoreAllMocks());

describe('freezeLocalWrites', () => {
  it('drops store-driven writes and removals but leaves reads and the restore batch working', () => {
    guardedLocalStorage.setItem('vinax.t', '"restored"');
    setLocal('vinax.u', 1);
    expect(localWritesFrozen()).toBe(false);
    freezeLocalWrites();
    expect(localWritesFrozen()).toBe(true);
    guardedLocalStorage.setItem('vinax.t', '"stale store state"');
    guardedLocalStorage.removeItem('vinax.t');
    setLocal('vinax.u', 2);
    removeLocal('vinax.u');
    expect(guardedLocalStorage.getItem('vinax.t')).toBe('"restored"');
    expect(getLocal('vinax.u', 0)).toBe(1);
    // An undo of the restore must still be able to write.
    expect(writeLocalBatch([['vinax.t', '"undone"']])).toEqual({ ok: true, written: 1 });
    expect(localStorage.getItem('vinax.t')).toBe('"undone"');
  });
});

describe('quota handling', () => {
  it('never throws and warns the listener once per session', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    expect(() => guardedLocalStorage.setItem('vinax.a', '1')).not.toThrow();
    expect(() => guardedLocalStorage.setItem('vinax.b', '2')).not.toThrow();
    await vi.waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));
    expect(useToastStore.getState().toasts[0].message).toBe('Storage is full — recent changes may not be saved');
    guardedLocalStorage.setItem('vinax.c', '3');
    await new Promise((r) => setTimeout(r, 0));
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  it('stays quiet for a non-quota failure', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(() => guardedLocalStorage.setItem('vinax.a', '1')).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});

describe('createDedupedStorage', () => {
  interface S {
    queue: string[];
    index: number;
  }

  it('N writes of a reference-identical state reach localStorage once', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem');
    const storage = createDedupedStorage<S>();
    const queue = ['a', 'b'];
    // partialize builds a NEW wrapper object every time; the fields are the same references.
    for (let i = 0; i < 25; i++) storage.setItem('vinax.p', { state: { queue, index: 1 }, version: 2 });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem('vinax.p') ?? 'null')).toEqual({ state: { queue: ['a', 'b'], index: 1 }, version: 2 });
    expect(storage.getItem('vinax.p')).toEqual({ state: { queue: ['a', 'b'], index: 1 }, version: 2 });
  });

  it('writes again when any field, the field set or the version changes', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem');
    const storage = createDedupedStorage<S>();
    const queue = ['a'];
    storage.setItem('vinax.p', { state: { queue, index: 0 }, version: 1 });
    storage.setItem('vinax.p', { state: { queue, index: 1 }, version: 1 });
    storage.setItem('vinax.p', { state: { queue: ['a'], index: 1 }, version: 1 }); // equal content, new reference
    storage.setItem('vinax.p', { state: { queue, index: 1 }, version: 2 });
    expect(spy).toHaveBeenCalledTimes(4);
    storage.removeItem('vinax.p');
    expect(localStorage.getItem('vinax.p')).toBeNull();
    storage.setItem('vinax.p', { state: { queue, index: 1 }, version: 2 });
    expect(spy).toHaveBeenCalledTimes(5);
  });

  it('retries a write the device refused instead of remembering it as written', () => {
    const storage = createDedupedStorage<S>();
    const state: S = { queue: [], index: 0 };
    const original = Storage.prototype.setItem;
    let fail = true;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (fail) throw new DOMException('full', 'QuotaExceededError');
      return original.call(this, k, v);
    });
    storage.setItem('vinax.p', { state, version: 0 });
    expect(localStorage.getItem('vinax.p')).toBeNull();
    fail = false;
    storage.setItem('vinax.p', { state, version: 0 });
    expect(localStorage.getItem('vinax.p')).not.toBeNull();
  });

  it('returns null for unreadable JSON and honours the freeze', () => {
    localStorage.setItem('vinax.p', '{broken');
    const storage = createDedupedStorage<S>();
    expect(storage.getItem('vinax.p')).toBeNull();
    freezeLocalWrites();
    storage.setItem('vinax.p', { state: { queue: [], index: 0 }, version: 0 });
    expect(localStorage.getItem('vinax.p')).toBe('{broken');
  });
});
