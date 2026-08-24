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
// E4 — artist + keyword blocks ride alongside id blocks.
let blockedArtists = new Set<string>();
let blockedKeywords: string[] = [];

export function isBlocked(id: string): boolean {
  return blocked.size > 0 && blocked.has(id);
}

/** E4 — full block check: id, any credited artist, or a title/subtitle
 *  keyword match. Cheap: the lists are admin-curated and tiny. */
export function isBlockedSong(song: { id: string; title?: string; subtitle?: string; artists?: Array<{ name: string }> }): boolean {
  if (blocked.has(song.id)) return true;
  if (blockedArtists.size > 0) {
    for (const a of song.artists ?? []) {
      if (a.name && blockedArtists.has(a.name.toLowerCase())) return true;
    }
  }
  if (blockedKeywords.length > 0) {
    const hay = `${song.title ?? ''} ${song.subtitle ?? ''}`.toLowerCase();
    for (const kw of blockedKeywords) if (hay.includes(kw)) return true;
  }
  return false;
}

export async function loadBlocklist(): Promise<void> {
  try {
    const res = await fetch(ENDPOINT, { cache: 'no-store' });
    if (!res.ok) return;
    const data = (await res.json()) as { ids?: string[]; artists?: string[]; keywords?: string[] };
    if (Array.isArray(data.ids)) blocked = new Set(data.ids);
    if (Array.isArray(data.artists)) blockedArtists = new Set(data.artists.map((a) => a.toLowerCase()));
    if (Array.isArray(data.keywords)) blockedKeywords = data.keywords.map((k) => k.toLowerCase()).filter((k) => k.length >= 3);
  } catch {
    /* best-effort; an unreachable blocklist must never break browsing */
  }
}
