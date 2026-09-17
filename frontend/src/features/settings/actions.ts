import { clearAllVinaxStorage, freezeLocalWrites } from '@/services/storage/local';
import { MAX_BACKUP_BYTES, applyTransferPayload, createBackup, createTransferPayload, parseBackup, recordBackupEvent, restoreWithUndo, serializeBackup, type BackupCategoryId } from './backup';
import { clearEvents } from '@/services/storage/idb';
import { resetProfile } from '@/services/personalization/storage';
import { invalidateRecommendationCache } from '@/services/recommendation/engine';
import { queryClient } from '@/services/queryClient';
import { useHistoryStore } from '@/store/historyStore';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import { toast } from '@/store/toastStore';

export function clearHistory(): void {
  useHistoryStore.getState().clearHistory();
}

export function clearFavorites(): void {
  useLibraryStore.getState().clearFavorites();
}

/** Same cap the history store keeps. */
const HISTORY_CAP = 150;
const UNDO_MS = 8000;
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/**
 * One-tap clears are undoable: the list is snapshotted, cleared, and a toast
 * offers Undo. Undo puts the snapshot back UNDER anything that arrived in
 * the meantime (a song that started playing, a new favourite) instead of
 * replacing it.
 */
export function clearHistoryWithUndo(): void {
  const snapshot = useHistoryStore.getState().entries;
  if (!snapshot.length) {
    toast('History is already empty');
    return;
  }
  clearHistory();
  toast(`Cleared ${plural(snapshot.length, 'play')}`, {
    duration: UNDO_MS,
    action: {
      label: 'Undo',
      onClick: () => {
        // Plays that arrived since the clear stay on top; the snapshot goes back under them.
        const seen = new Set<string>();
        const entries = [...useHistoryStore.getState().entries, ...snapshot].filter((e) => {
          const key = `${e.ts}|${e.song.id}`;
          return seen.has(key) ? false : (seen.add(key), true);
        });
        useHistoryStore.setState({ entries: entries.sort((a, b) => b.ts - a.ts).slice(0, HISTORY_CAP) });
      },
    },
  });
}

export function clearFavoritesWithUndo(): void {
  const snapshot = useLibraryStore.getState().favorites;
  if (!snapshot.length) {
    toast('No favorites to clear');
    return;
  }
  clearFavorites();
  toast(`Cleared ${plural(snapshot.length, 'favorite')}`, {
    duration: UNDO_MS,
    action: {
      label: 'Undo',
      // Anything liked since the clear stays; the store rebuilds its id index.
      onClick: () => useLibraryStore.getState().restoreFavorites(snapshot),
    },
  });
}

/** Erasing the taste profile cannot be undone, so it is confirmed first. */
export async function confirmClearPersonalization(): Promise<void> {
  if (!window.confirm('Erase your taste profile and listening event log? Recommendations start over. This cannot be undone.')) return;
  await clearPersonalization();
  toast('Personalization profile cleared');
}

/**
 * Read a picked backup file safely: the size is checked BEFORE the file is
 * pulled into memory, and a read failure is reported instead of thrown.
 */
export async function readBackupFile(file: File): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  if (file.size > MAX_BACKUP_BYTES) return { ok: false, error: 'Backup file is larger than 8 MB.' };
  try {
    return { ok: true, text: await file.text() };
  } catch {
    return { ok: false, error: 'This file could not be read.' };
  }
}

export function clearQueue(): void {
  usePlayerStore.getState().clearQueue();
}

export function clearCachedMetadata(): void {
  queryClient.clear();
}

export async function clearPersonalization(): Promise<void> {
  await resetProfile();
  invalidateRecommendationCache();
  await queryClient.invalidateQueries({ queryKey: ['mixes'] });
}

export async function resetAppState(): Promise<void> {
  await clearEvents();
  clearAllVinaxStorage();
  window.location.assign('/');
}

/**
 * Export the listener's portable data as a versioned backup file
 * (features/settings/backup.ts). Credentials, device identity, caches and
 * download paths are never included — see BACKUP_EXCLUSIONS.
 */
export function exportProfileJson(): string {
  return serializeBackup(createBackup());
}

export function downloadProfileExport(): void {
  const file = createBackup();
  const json = serializeBackup(file);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `vinax-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  recordBackupEvent({
    lastExportAt: Date.now(),
    lastExportBytes: json.length,
    lastExportCategories: Object.keys(file.categories) as BackupCategoryId[],
  });
}

export type ImportOutcome =
  | { ok: true; applied: BackupCategoryId[]; pendingHandle: string | null; warnings: string[] }
  | { ok: false; error: string; rejected?: Array<{ label: string; error: string }> };

/**
 * Validate a backup file and restore it wholesale (replace mode). A malformed
 * file — or one with any malformed category — changes nothing; a storage
 * failure rolls back and reports. Only a fully applied restore reloads.
 */
export function importProfileJson(json: string, opts: { reload?: boolean } = {}): ImportOutcome {
  const parsed = parseBackup(json);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  if (parsed.rejected.length) {
    return {
      ok: false,
      error: `${parsed.rejected.length} section${parsed.rejected.length === 1 ? ' is' : 's are'} damaged — nothing was restored.`,
      rejected: parsed.rejected.map((r) => ({ label: r.label, error: r.error })),
    };
  }
  // Same safety copy as the Backup Center, so this one-tap replace can be undone there.
  const res = restoreWithUndo(parsed, { mode: 'replace' });
  if (!res.ok) return { ok: false, error: res.message };
  if (opts.reload !== false) {
    // Live stores hold the pre-restore state — nothing they persist before the reload may overwrite it.
    freezeLocalWrites();
    window.location.reload();
  }
  return { ok: true, applied: res.applied, pendingHandle: res.pendingHandle, warnings: parsed.warnings };
}

/** Device handoff payload: the backup PLUS device identity (see createTransferPayload). */
export function exportTransferJson(): string {
  return JSON.stringify(createTransferPayload());
}

/** Apply a device handoff payload; reloads on success. */
export function importTransferJson(json: string): { ok: true } | { ok: false; error: string } {
  const res = applyTransferPayload(json);
  if (!res.ok) return { ok: false, error: 'message' in res ? res.message : res.error };
  freezeLocalWrites();
  window.location.reload();
  return { ok: true };
}
