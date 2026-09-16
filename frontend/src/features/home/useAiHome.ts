import { useQuery } from '@tanstack/react-query';
import type { Song } from '@/types';
import { searchSongs } from '@/services/api';
import { rankSongs } from '@/features/search/useSearch';
import { freshSongs } from '@/services/recommendation/freshness';
import { servedKeySet } from '@/services/recommendation/songIdentity';
import { profileStamp } from '@/services/personalization/storage';
import { useSettingsStore } from '@/store/settingsStore';
import { useHistoryStore } from '@/store/historyStore';
import { useDiscoveryStore } from '@/store/discoveryStore';
import { isSongBlocked, useLibraryStore } from '@/store/libraryStore';
import { HOME_VISIT_NONCE, designHomeShelves, loadShownSongIds, recordShownShelves, recordShownSongs, type AiShelfDefinition } from '@/services/ai/home';

/**
 * v6.2.0 / v6.4.0 — "Designed for you": the AI designs titled shelves
 * (services/ai/home.ts) and each one is resolved against the real catalogue
 * here. Refreshes per half-day, taste change, language change, "Refresh
 * discovery" and per app load (visit nonce); steers away from the last 30
 * shelf titles and the last 200 songs it showed, so consecutive builds differ
 * while staying personalised. Empty (the block renders nothing) when the AI
 * is off, unconfigured or slow — the ordinary shelves are unaffected.
 */
export interface AiShelf extends AiShelfDefinition {
  songs: Song[];
}

const MIN_SONGS = 4;

function halfDayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours() < 12 ? 'am' : 'pm'}`;
}

export async function designAndResolve(signal?: AbortSignal): Promise<AiShelf[]> {
  const sections = await designHomeShelves(signal);
  if (!sections.length) return [];
  const settings = useSettingsStore.getState();
  const lib = useLibraryStore.getState();
  const served = servedKeySet();
  const shownBefore = new Set(loadShownSongIds());
  const results = await Promise.allSettled(sections.map((s) => searchSongs(s.query, 16, { signal })));
  const seenIds = new Set<string>();
  const shelves: AiShelf[] = [];
  sections.forEach((section, i) => {
    const r = results[i];
    if (r.status !== 'fulfilled') return;
    const ranked = rankSongs(r.value);
    // Prefer songs not shown on AI shelves recently; fall back to them only to reach the minimum.
    const fresh = freshSongs(ranked, { excludeIds: new Set([...seenIds, ...shownBefore]), excludeKeys: served, muted: settings.mutedLanguages, blocked: (s) => isSongBlocked(s, lib) });
    const songs = (fresh.length >= MIN_SONGS ? fresh : freshSongs(ranked, { excludeIds: seenIds, excludeKeys: served, muted: settings.mutedLanguages, blocked: (s) => isSongBlocked(s, lib) })).slice(0, 12);
    if (songs.length < MIN_SONGS) return;
    songs.forEach((s) => seenIds.add(s.id));
    shelves.push({ ...section, songs });
  });
  if (shelves.length) {
    recordShownShelves(shelves);
    recordShownSongs(shelves.flatMap((s) => s.songs));
  }
  return shelves;
}

export function useAiHome(enabled: boolean) {
  const pinned = useSettingsStore((s) => s.pinnedLanguages);
  const muted = useSettingsStore((s) => s.mutedLanguages);
  const on = useSettingsStore((s) => s.aiHomeShelves);
  const round = useDiscoveryStore((s) => s.round);
  const hasTaste = useHistoryStore((s) => s.entries.length > 0);
  return useQuery<AiShelf[]>({
    queryKey: ['ai-home-shelves', halfDayKey(), profileStamp(), pinned, muted, round, HOME_VISIT_NONCE],
    enabled: enabled && on && (hasTaste || pinned.length > 0),
    staleTime: 6 * 60 * 60_000,
    gcTime: 12 * 60 * 60_000,
    retry: false,
    queryFn: ({ signal }) => designAndResolve(signal),
  });
}
