import { CURRENT_SCHEMA_VERSION, KEYS, STORAGE_PREFIX } from '@/constants/storage-keys';

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
