import type { PersistStorage, StateStorage, StorageValue } from 'zustand/middleware';
import { CURRENT_SCHEMA_VERSION, KEYS, STORAGE_PREFIX } from '@/constants/storage-keys';

/**
 * Write freeze. A restore writes the listener's data straight into
 * localStorage and then reloads; in the gap every live store still holds the
 * OLD state and would persist it over the restored keys on its next `set`
 * (a progress tick is enough). Once frozen, every store-driven write in this
 * page is dropped — only writeLocalBatch (the restore itself) still writes.
 * The flag lives for the page's lifetime: the reload that follows clears it.
 */
let frozen = false;
export function freezeLocalWrites(): void {
  frozen = true;
}
export const localWritesFrozen = (): boolean => frozen;

let quotaWarned = false;
/** Tell the listener — once per session — that the device stopped accepting writes. */
function warnStorageFull(): void {
  if (quotaWarned) return;
  quotaWarned = true;
  // Lazy: the toast store must not become a static dependency of storage.
  void import('@/store/toastStore')
    .then((m) => m.toast('Storage is full — recent changes may not be saved', { duration: 6000 }))
    .catch(() => undefined);
}

/** Test seam: clears the freeze and the once-per-session warning. */
export function resetLocalGuardsForTests(): void {
  frozen = false;
  quotaWarned = false;
}

/** false when the write was dropped (frozen) or refused (quota / unavailable). Never throws. */
function guardedWrite(name: string, raw: string): boolean {
  if (frozen) return false;
  try {
    window.localStorage.setItem(name, raw);
    return true;
  } catch (e) {
    if (classify(e) === 'quota') warnStorageFull();
    return false;
  }
}

/**
 * The storage every persisted store goes through: window.localStorage, but
 * writes are dropped while a restore is waiting for its reload, and a
 * quota error is reported to the listener instead of thrown into a `set`.
 */
export const guardedLocalStorage: StateStorage = {
  getItem: (name) => {
    try {
      return window.localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    guardedWrite(name, value);
  },
  removeItem: (name) => {
    if (frozen) return;
    try {
      window.localStorage.removeItem(name);
    } catch {
      /* ignore */
    }
  },
};

/**
 * A persist storage that skips the write when no persisted field changed.
 * zustand persists on EVERY `set`, and `partialize` builds a fresh object
 * each time, so a store that ticks (playback progress) re-serialises its
 * whole queue several times a second. Fields are compared by reference
 * against the last state actually written; the stored JSON keeps the usual
 * `{ state, version }` shape.
 */
export function createDedupedStorage<S>(): PersistStorage<S> {
  let last: { name: string; version: number | undefined; state: S } | null = null;
  const same = (a: S, b: S): boolean => {
    if (Object.is(a, b)) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    const x = a as Record<string, unknown>;
    const y = b as Record<string, unknown>;
    const keys = Object.keys(x);
    if (keys.length !== Object.keys(y).length) return false;
    return keys.every((k) => Object.prototype.hasOwnProperty.call(y, k) && Object.is(x[k], y[k]));
  };
  return {
    getItem: (name) => {
      const raw = guardedLocalStorage.getItem(name) as string | null;
      if (raw == null) return null;
      try {
        return JSON.parse(raw) as StorageValue<S>;
      } catch {
        return null;
      }
    },
    setItem: (name, value) => {
      if (last && last.name === name && last.version === value.version && same(last.state, value.state)) return;
      // Only a write that landed counts as "last written" — a refused one is retried.
      last = guardedWrite(name, JSON.stringify(value)) ? { name, version: value.version, state: value.state } : null;
    },
    removeItem: (name) => {
      last = null;
      void guardedLocalStorage.removeItem(name);
    },
  };
}

export function getLocal<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function setLocal<T>(key: string, value: T): void {
  if (frozen) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded / private mode: degrade silently, app stays functional.
  }
}

export type StorageFailure = { ok: false; error: 'quota' | 'unavailable'; message: string; rolledBack: boolean };
export type StorageWriteResult = { ok: true; written: number } | StorageFailure;

function classify(e: unknown): 'quota' | 'unavailable' {
  const err = e as { name?: string; code?: number } | null;
  const name = err?.name ?? '';
  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || err?.code === 22 || err?.code === 1014) return 'quota';
  return 'unavailable';
}

/**
 * All-or-nothing localStorage write. Every entry is written in order (a
 * `null` value removes the key); if any write throws — quota exceeded,
 * private mode, storage disabled — every key touched so far is restored to
 * its previous value and the failure is REPORTED instead of swallowed. The
 * silent setLocal() above is right for hot-path preference writes; a restore
 * of the listener's whole library must never half-apply and then say "done".
 */
export function writeLocalBatch(entries: ReadonlyArray<readonly [key: string, raw: string | null]>): StorageWriteResult {
  let storage: Storage;
  try {
    storage = window.localStorage;
    if (!storage) throw new Error('no storage');
  } catch {
    return { ok: false, error: 'unavailable', message: 'Device storage is not available in this browser mode.', rolledBack: true };
  }
  const previous: Array<readonly [string, string | null]> = [];
  for (const [key, raw] of entries) {
    let before: string | null = null;
    try {
      before = storage.getItem(key);
    } catch {
      /* treat as absent */
    }
    try {
      if (raw === null) storage.removeItem(key);
      else storage.setItem(key, raw);
      previous.push([key, before]);
    } catch (e) {
      const error = classify(e);
      let rolledBack = true;
      for (const [k, v] of previous.reverse()) {
        try {
          if (v === null) storage.removeItem(k);
          else storage.setItem(k, v);
        } catch {
          rolledBack = false;
        }
      }
      return {
        ok: false,
        error,
        message:
          error === 'quota'
            ? 'This device is out of storage space for VinaX. Nothing was changed.'
            : 'Device storage refused the write. Nothing was changed.',
        rolledBack,
      };
    }
  }
  return { ok: true, written: entries.length };
}

export function removeLocal(key: string): void {
  if (frozen) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function clearAllVinaxStorage(): void {
  try {
    const doomed: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(STORAGE_PREFIX)) doomed.push(k);
    }
    doomed.forEach((k) => window.localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

/** Approximate bytes used by VinaX keys in localStorage. */
export function localStorageUsageBytes(): number {
  let total = 0;
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(STORAGE_PREFIX)) {
        total += k.length + (window.localStorage.getItem(k)?.length ?? 0);
      }
    }
  } catch {
    /* ignore */
  }
  return total * 2; // UTF-16
}

/**
 * Versioned migrations. v1 is the initial schema; when v2 ships, add a
 * stepwise migration here (never destructive without a documented reason).
 */
export function runMigrations(): void {
  const v = getLocal<number>(KEYS.schemaVersion, 0);
  if (v === CURRENT_SCHEMA_VERSION) return;
  // v1 → v2: tarang.* → vinax.* key rename. Handled by earlyMigrations.ts
  // (must run before store rehydration); here we only record the version.
  setLocal(KEYS.schemaVersion, CURRENT_SCHEMA_VERSION);
}
