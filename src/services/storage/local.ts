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
