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

try {
  const oldKeys: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (k && k.startsWith(OLD_PREFIX)) oldKeys.push(k);
  }
  for (const k of oldKeys) {
    const target = NEW_PREFIX + k.slice(OLD_PREFIX.length);
    if (window.localStorage.getItem(target) == null) {
      const value = window.localStorage.getItem(k);
      if (value != null) window.localStorage.setItem(target, value);
    }
    window.localStorage.removeItem(k);
  }
} catch {
  // Private mode / storage unavailable — app still works, just unpersisted.
}

export {};
