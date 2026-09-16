import { clearAllVinaxStorage } from '@/services/storage/local';
import { applyBackup, applyTransferPayload, createBackup, createTransferPayload, parseBackup, recordBackupEvent, serializeBackup, type BackupCategoryId } from './backup';
import { clearEvents } from '@/services/storage/idb';
import { resetProfile } from '@/services/personalization/storage';
import { invalidateRecommendationCache } from '@/services/recommendation/engine';
import { queryClient } from '@/services/queryClient';
import { useHistoryStore } from '@/store/historyStore';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';

export function clearHistory(): void {
  useHistoryStore.getState().clearHistory();
}

export function clearFavorites(): void {
  useLibraryStore.getState().clearFavorites();
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
  const res = applyBackup(parsed, { mode: 'replace' });
  if (!res.ok) return { ok: false, error: res.message };
  if (opts.reload !== false) window.location.reload();
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
  window.location.reload();
  return { ok: true };
}
