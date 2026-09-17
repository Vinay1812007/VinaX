/**
 * Runs at module-evaluation time, BEFORE any zustand store rehydrates —
 * imported FIRST in main.tsx. Moving this into runMigrations() (which runs in
 * a layout effect) would lose data: stores would rehydrate from the empty
 * new-prefix keys and overwrite the migrated values on first persist.
 *
 * v1 → v2: brand rename moved every localStorage key from `tarang.*` to
 * `vinax.*`. Idempotent; never overwrites an existing new-prefix key.
 */
const OLD_PREFIX = 'tarang.';
const NEW_PREFIX = 'vinax.';

/**
 * Move one key. Order matters for safety: read, remove the old key, write
 * the new one — and if that write throws (quota: the old copy no longer
 * frees room once both exist), put the old key back so nothing is lost and
 * the next launch retries. When the new-prefix key already exists with
 * DIFFERENT content the old key is kept: it may be the only copy of data the
 * listener cares about, and deleting it silently is not this module's call.
 */
function moveKey(storage: Storage, oldKey: string): void {
  const target = NEW_PREFIX + oldKey.slice(OLD_PREFIX.length);
  const value = storage.getItem(oldKey);
  if (value == null) return;
  const existing = storage.getItem(target);
  if (existing != null) {
    if (existing === value) storage.removeItem(oldKey);
    return;
  }
  storage.removeItem(oldKey);
  try {
    storage.setItem(target, value);
  } catch {
    try {
      storage.removeItem(target);
      storage.setItem(oldKey, value);
    } catch {
      /* storage refused even the put-back — nothing more can be done here */
    }
  }
}

try {
  const storage = window.localStorage;
  const oldKeys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k && k.startsWith(OLD_PREFIX)) oldKeys.push(k);
  }
  for (const k of oldKeys) {
    // Per key: one unreadable or unwritable key must not strand the rest.
    try {
      moveKey(storage, k);
    } catch {
      /* skip this key */
    }
  }
} catch {
  // Private mode / storage unavailable — app still works, just unpersisted.
}

export {};
