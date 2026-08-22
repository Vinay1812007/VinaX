import { isNativePlatform } from '@/services/native';

/**
 * Song blocklist managed from the admin Content dashboard. The app fetches the
 * blocked ids once at startup and filters them out of all normalized song
 * lists (search, shelves, charts, AI/local queue resolution).
 */
const ENDPOINT = isNativePlatform()
  ? 'https://www.sirimillavinay.online/api/blocklist'
  : '/api/blocklist';

let blocked = new Set<string>();

export function isBlocked(id: string): boolean {
  return blocked.size > 0 && blocked.has(id);
}

export async function loadBlocklist(): Promise<void> {
  try {
    const res = await fetch(ENDPOINT, { cache: 'no-store' });
    if (!res.ok) return;
    const data = (await res.json()) as { ids?: string[] };
    if (Array.isArray(data.ids)) blocked = new Set(data.ids);
  } catch {
    /* best-effort; an unreachable blocklist must never break browsing */
  }
}
