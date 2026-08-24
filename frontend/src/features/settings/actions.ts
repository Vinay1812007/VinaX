import { KEYS } from '@/constants/storage-keys';
import { clearAllVinaxStorage, getLocal, setLocal } from '@/services/storage/local';
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

/** Export every local preference + the taste profile as portable JSON. */
export function exportProfileJson(): string {
  const data: Record<string, unknown> = { exportedAt: new Date().toISOString(), app: 'vinax' };
  for (const [name, key] of Object.entries(KEYS)) {
    data[name] = getLocal<unknown>(key, null);
  }
  return JSON.stringify(data, null, 2);
}

export function downloadProfileExport(): void {
  const blob = new Blob([exportProfileJson()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `vinax-profile-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function importProfileJson(json: string): boolean {
  try {
    const data = JSON.parse(json) as Record<string, unknown>;
    if (data.app !== 'vinax' && data.app !== 'tarang') return false;

    // Validate: only allow known keys (from KEYS + export metadata)
    const allowedKeys = new Set(['app', 'exportedAt', ...Object.keys(KEYS)]);
    if (Object.keys(data).some((k) => !allowedKeys.has(k))) {
      throw new Error('Invalid profile: unknown keys detected');
    }

    // Size-limit: reject payloads over 5 MB
    if (json.length > 5 * 1024 * 1024) {
      throw new Error('Profile too large (max 5 MB)');
    }

    for (const [name, key] of Object.entries(KEYS)) {
      if (data[name] != null) setLocal(key, data[name]);
    }
    window.location.reload();
    return true;
  } catch {
    return false;
  }
}
