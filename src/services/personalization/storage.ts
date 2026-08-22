import { KEYS } from '@/constants/storage-keys';
import { getLocal, removeLocal, setLocal } from '@/services/storage/local';
import { clearEvents } from '@/services/storage/idb';
import { applyDecay, createEmptyProfile, type TasteProfile } from './profile';

let cached: TasteProfile | null = null;
let _pendingProfile: TasteProfile | null = null;

export function loadProfile(): TasteProfile {
  if (cached) return cached;
  const stored = getLocal<TasteProfile | null>(KEYS.profile, null);
  cached = stored && stored.version === 1 ? stored : createEmptyProfile();
  if (!cached.hourBuckets) cached.hourBuckets = {};
  applyDecay(cached);
  return cached;
}

let saveTimer: number | null = null;

/** Force any pending debounced save through immediately. Safe to call
 *  repeatedly; a no-op when there's nothing pending. */
function flushProfile(): void {
  if (saveTimer == null) return;
  window.clearTimeout(saveTimer);
  saveTimer = null;
  if (cached) setLocal(KEYS.profile, cached);
  _pendingProfile = null;
}

// A tab hidden or backgrounded before the 800ms debounce elapses would lose
// the pending write. Flush synchronously on pagehide (fires reliably on iOS
// where 'beforeunload' does not) and on visibilitychange → hidden.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushProfile);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) flushProfile();
    });
  }
}

/** Debounced persistence — profile updates happen on every play event. */
export function saveProfile(profile: TasteProfile): void {
  cached = profile;
  if (saveTimer != null) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    setLocal(KEYS.profile, profile);
    saveTimer = null;
    _pendingProfile = null;
  }, 800);
}

/**
 * Read-modify-write the taste profile safely.
 * Uses _pendingProfile to ensure concurrent calls within
 * the 800ms debounce window see each other's modifications
 * instead of all reading the same stale state.
 */
export function withProfile(updater: (profile: TasteProfile) => TasteProfile): void {
  const current = _pendingProfile ?? loadProfile();
  const updated = updater(current);
  _pendingProfile = updated;
  saveProfile(updated);
}

export async function resetProfile(): Promise<void> {
  cached = createEmptyProfile();
  _pendingProfile = null;
  removeLocal(KEYS.profile);
  await clearEvents();
}

/** Monotonic-ish stamp used as a react-query cache key component. */
export function profileStamp(): string {
  const p = loadProfile();
  return `${p.totals.plays}-${p.totals.favorites}-${p.totals.skips}`;
}
