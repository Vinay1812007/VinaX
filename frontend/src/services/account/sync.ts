/**
 * 13.0 — the signed-in listener's data follows their Google account.
 *
 * What syncs is the backup file's own categories (features/settings/backup):
 * settings, library and playlists, smart collections, history, taste profile,
 * bookmarks and the Home layout. Never AI chats, searches or this device's
 * identity. The server keeps ONE copy per account (GET/PUT /api/account/data)
 * with a version number:
 *
 *   pull  — on sign-in and on app start: the account's copy is MERGED into
 *           this device (the backup restore's merge: nothing local is lost),
 *           the stores re-read storage, and the merged result is pushed.
 *   push  — a few seconds after anything synced changes, when the app goes to
 *           the background, and every few minutes while it runs. A push names
 *           the version it last saw; if another device wrote first the server
 *           answers 409 with its copy, which is merged and pushed again.
 *
 * Signed out, nothing runs. A failure leaves the device as it is and tries again later.
 */
import { applyBackup, createBackup, parseBackup, type BackupCategoryId } from '@/features/settings/backup';
import { currentAccount, onAccountChange } from '@/services/auth/google';
import { isNativePlatform } from '@/services/native';

const ORIGIN = isNativePlatform() ? 'https://www.vinaxmusic.online' : '';
export const SYNC_ENDPOINT = `${ORIGIN}/api/account/data`;
/** The categories that follow the account. */
export const SYNC_CATEGORIES: readonly BackupCategoryId[] = ['settings', 'library', 'smartCollections', 'history', 'taste', 'bookmarks', 'homeLayout'];
const STATE_KEY = 'vinax.account.sync.v1';
const PUSH_DELAY_MS = 4_000;
// 13.5.0 — 10 minutes, was 3. Each tick is a pull (a Worker request) even
// when nothing changed; local changes still push 4 s after they happen, and
// a round also runs when the tab is hidden and when it comes back online.
const PUSH_EVERY_MS = 10 * 60_000;
/** The server's cap is 2 MB; stay under it. */
const MAX_BYTES = 1_900_000;

interface SyncState {
  /** The account this state belongs to (its session's subject is not readable here, so the email). */
  who: string;
  /** The server version this device last merged or wrote. */
  version: number;
  /** A fingerprint of what was last pushed, so an unchanged library is not re-sent. */
  pushed: string;
  at: number;
}

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'offline' | 'error' | 'signed_out';
let status: SyncStatus = 'idle';
const listeners = new Set<(s: SyncStatus) => void>();
const setStatus = (s: SyncStatus): void => {
  status = s;
  for (const cb of listeners) cb(s);
};
export const syncStatus = (): SyncStatus => status;
export function onSyncStatus(cb: (s: SyncStatus) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function readState(who: string): SyncState {
  try {
    const s = JSON.parse(localStorage.getItem(STATE_KEY) ?? 'null') as SyncState | null;
    if (s && s.who === who && Number.isInteger(s.version)) return s;
  } catch {
    /* private mode or bad JSON: start over */
  }
  return { who, version: 0, pushed: '', at: 0 };
}
function writeState(s: SyncState): void {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(s));
  } catch {
    /* storage full or blocked: the next run starts from version 0 and merges */
  }
}

/** A short, stable fingerprint of a string (not security, just change detection). */
export function fingerprint(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return `${text.length}:${(h >>> 0).toString(36)}`;
}

/** This device's synced data as a backup file (the `exportedAt` stamp is left out of the fingerprint). */
function snapshot(): { backup: Record<string, unknown>; text: string; print: string } {
  const backup = createBackup(SYNC_CATEGORIES) as unknown as Record<string, unknown>;
  const { exportedAt: _at, ...stable } = backup as { exportedAt?: unknown };
  void _at;
  const text = JSON.stringify(backup);
  return { backup, text, print: fingerprint(JSON.stringify(stable)) };
}

/** Re-read the persisted stores after a merge wrote new data under them. */
async function rehydrate(): Promise<void> {
  const mods = await Promise.allSettled([
    import('@/store/libraryStore').then((m) => m.useLibraryStore),
    import('@/store/historyStore').then((m) => m.useHistoryStore),
    import('@/store/settingsStore').then((m) => m.useSettingsStore),
    import('@/store/smartCollectionStore').then((m) => m.useSmartCollectionStore),
    import('@/store/bookmarkStore').then((m) => m.useBookmarkStore),
  ]);
  for (const r of mods) {
    const store = r.status === 'fulfilled' ? (r.value as { persist?: { rehydrate?: () => unknown } }) : null;
    try {
      await store?.persist?.rehydrate?.();
    } catch {
      /* a store that cannot re-read keeps what it has */
    }
  }
}

/** Merge a server copy into this device. True when anything was written. */
function mergeIn(backup: unknown): boolean {
  const parsed = parseBackup(JSON.stringify(backup));
  if (!parsed.ok) return false;
  const res = applyBackup(parsed, { mode: 'merge', categories: SYNC_CATEGORIES });
  return res.ok && res.applied.length > 0;
}

let running: Promise<void> | null = null;
let again = false;

/** One full round: pull and merge the account's copy, then push this device's. */
export function syncNow(fetchImpl: typeof fetch = fetch): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = round(fetchImpl).finally(() => {
    running = null;
    if (again) {
      again = false;
      void syncNow(fetchImpl);
    }
  });
  return running;
}

async function round(fetchImpl: typeof fetch): Promise<void> {
  const account = currentAccount();
  if (!account) return setStatus('signed_out');
  const who = account.user.email ?? account.session.slice(4, 20);
  const auth = { authorization: `Bearer ${account.session}` };
  let st = readState(who);
  setStatus('syncing');
  try {
    // Pull: merge the account's copy when it is newer than what this device saw.
    const got = await fetchImpl(SYNC_ENDPOINT, { headers: auth, cache: 'no-store' });
    if (got.status === 401) return setStatus('signed_out');
    if (got.status === 200) {
      const j = (await got.json()) as { version: number; backup: unknown };
      if (j.version > st.version) {
        if (mergeIn(j.backup)) await rehydrate();
        st = { ...st, version: j.version };
        writeState(st);
      }
    } else if (got.status !== 204) {
      return setStatus('error');
    }
    // Push: this device's data, merged, unless it is what was pushed last.
    for (let attempt = 0; attempt < 3; attempt++) {
      const snap = snapshot();
      if (snap.print === st.pushed && st.version > 0) break;
      if (snap.text.length > MAX_BYTES) return setStatus('error');
      const put = await fetchImpl(SYNC_ENDPOINT, {
        method: 'PUT',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ version: st.version, backup: snap.backup }),
      });
      if (put.status === 200) {
        const j = (await put.json()) as { version: number };
        st = { who, version: j.version, pushed: snap.print, at: Date.now() };
        writeState(st);
        break;
      }
      if (put.status === 409) {
        // Another device wrote first: take its copy in, then try again.
        const j = (await put.json()) as { version: number; backup: unknown };
        if (mergeIn(j.backup)) await rehydrate();
        st = { ...st, version: j.version };
        writeState(st);
        continue;
      }
      if (put.status === 401) return setStatus('signed_out');
      return setStatus('error');
    }
    setStatus('synced');
  } catch {
    setStatus(typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'error');
  }
}

let installed = false;
let pushTimer: ReturnType<typeof setTimeout> | null = null;

/** Push a few seconds after a change (several quick changes make one push). */
export function scheduleSync(): void {
  if (!currentAccount()) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void syncNow();
  }, PUSH_DELAY_MS);
}

/** App start: sync now, on every change of the synced stores, when hidden, on sign-in, and on a slow timer. */
export function installAccountSync(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  void syncNow();
  // 13.4.0 — a new SESSION syncs; a refreshed name or photo on the same
  // session does not (that rewrite used to start a sync round every time).
  let lastSession = currentAccount()?.session ?? null;
  onAccountChange((a) => {
    const session = a?.session ?? null;
    if (session === lastSession) return;
    lastSession = session;
    if (a) void syncNow();
    else setStatus('signed_out');
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void syncNow();
  });
  window.addEventListener('online', () => void syncNow());
  setInterval(() => {
    if (document.visibilityState === 'visible') void syncNow();
  }, PUSH_EVERY_MS);
  void Promise.allSettled([
    import('@/store/libraryStore').then((m) => m.useLibraryStore.subscribe(scheduleSync)),
    import('@/store/historyStore').then((m) => m.useHistoryStore.subscribe(scheduleSync)),
    import('@/store/settingsStore').then((m) => m.useSettingsStore.subscribe(scheduleSync)),
    import('@/store/smartCollectionStore').then((m) => m.useSmartCollectionStore.subscribe(scheduleSync)),
    import('@/store/bookmarkStore').then((m) => m.useBookmarkStore.subscribe(scheduleSync)),
  ]);
}
