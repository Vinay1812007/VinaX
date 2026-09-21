import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { Song } from '@/types';
import { searchSongs, searchSongsPage } from '@/services/api';
import { rankSongs } from '@/features/search/useSearch';
import { freshSongs } from '@/services/recommendation/freshness';
import { servedKeySet } from '@/services/recommendation/songIdentity';
import { softMutedArtist } from '@/services/recommendation/profiles';
import { loadProfile } from '@/services/personalization/storage';
import { useSettingsStore } from '@/store/settingsStore';
import { useHistoryStore } from '@/store/historyStore';
import { useDiscoveryStore } from '@/store/discoveryStore';
import { isSongBlocked, useLibraryStore } from '@/store/libraryStore';
import { designHomeShelves, loadShownSongIds, recordShownShelves, recordShownSongs, type AiShelfDefinition } from '@/services/ai/home';
import { biasUnseenFirst, rotatePage } from './homeVariety';
import { useShelfSafety } from './useShelfSafety';

/**
 * v6.2.0 / v6.4.0 / v6.5.0 — "Designed for you": the AI designs titled
 * shelves (services/ai/home.ts) and each one is resolved against the real
 * catalogue here. Since 6.5 (the 3.9 behaviour) Home is REBUILT ON EVERY
 * OPEN: a per-mount visit nonce keys the build, each shelf's query reads a
 * rotated catalogue page for that visit, and songs this listener was shown
 * recently sink below unseen ones — so two consecutive opens differ while
 * staying personal. It also steers the model away from the last 30 shelf
 * titles and the last 200 songs it showed. Empty (the block renders nothing)
 * when the AI is off, unconfigured or slow — the ordinary shelves are
 * unaffected.
 */
export interface AiShelf extends AiShelfDefinition {
  songs: Song[];
}

const MIN_SONGS = 4;
const PAGE_SIZE = 18;
const ROTATE_PAGES = 3;

const newVisitNonce = (): number => Math.floor(Math.random() * 1_000_000);

/** One shelf's catalogue read for this visit: a rotated page, with page 1 as the floor when it runs thin. */
async function fetchShelfSongs(query: string, page: number, signal?: AbortSignal): Promise<Song[]> {
  const first = page > 1 ? await searchSongsPage(query, page, PAGE_SIZE, { signal }).catch(() => [] as Song[]) : [];
  if (first.length >= MIN_SONGS * 2) return first;
  const base = await searchSongs(query, PAGE_SIZE, { signal });
  const seen = new Set(first.map((s) => s.id));
  return [...first, ...base.filter((s) => !seen.has(s.id))];
}

export async function designAndResolve(signal?: AbortSignal, visitNonce = newVisitNonce()): Promise<AiShelf[]> {
  const sections = await designHomeShelves(signal, visitNonce);
  if (!sections.length) return [];
  const settings = useSettingsStore.getState();
  const lib = useLibraryStore.getState();
  const softMuted = loadProfile().softMuted;
  const served = servedKeySet();
  const shownBefore = new Set(loadShownSongIds());
  const results = await Promise.allSettled(sections.map((s, i) => fetchShelfSongs(s.query, rotatePage(s.query, visitNonce, i, ROTATE_PAGES), signal)));
  const seenIds = new Set<string>();
  const shelves: AiShelf[] = [];
  sections.forEach((section, i) => {
    const r = results[i];
    if (r.status !== 'fulfilled') return;
    const ranked = rankSongs(r.value);
    // Songs not shown on AI shelves recently come first; shown ones only fill up.
    // (rankSongs has already dropped explicit songs in Kid mode.) The hook re-applies all of this on render.
    const admitted = freshSongs(ranked, { excludeIds: seenIds, excludeKeys: served, muted: settings.mutedLanguages, blocked: (s) => isSongBlocked(s, lib) || softMutedArtist(s, softMuted) });
    const songs = biasUnseenFirst(admitted, shownBefore).slice(0, 12);
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

export interface AiHomeResult {
  /** The shelves, with the listener's CURRENT safety settings applied (see ./useShelfSafety). */
  data: AiShelf[] | undefined;
  isLoading: boolean;
  /** The previous design, shown while a new one is on its way. */
  isPlaceholderData: boolean;
}

export function useAiHome(enabled: boolean): AiHomeResult {
  const pinned = useSettingsStore((s) => s.pinnedLanguages);
  const on = useSettingsStore((s) => s.aiHomeShelves);
  const round = useDiscoveryStore((s) => s.round);
  const hasTaste = useHistoryStore((s) => s.entries.length > 0);
  const allowed = useShelfSafety();
  // A new nonce per mount: every Home open designs afresh (never reuses the
  // last build), while the same open keeps its shelves through re-renders.
  const [visitNonce] = useState(newVisitNonce);
  const query = useQuery<AiShelf[]>({
    // v7.0.0 — the profile stamp is NOT in the key: it changes on every play,
    // skip and like, and each change used to throw the shelves away and spend
    // another design call while Home was simply open. One design per Home
    // open (the nonce), plus the settings that change what should be designed.
    // 7.2.0 — safety settings (Kid mode, muted languages, hidden songs and
    // artists, soft mutes) are NOT in the key either: they are applied below,
    // on every render, to cached and placeholder shelves alike, so a newly
    // forbidden song disappears at once without another design call.
    queryKey: ['ai-home-shelves', visitNonce, pinned, round],
    enabled: enabled && on && (hasTaste || pinned.length > 0),
    staleTime: 0,
    gcTime: 5 * 60_000,
    placeholderData: keepPreviousData,
    retry: false,
    queryFn: ({ signal }) => designAndResolve(signal, visitNonce),
  });
  // Every render, not memoised: the server blocklist is not a store, so the
  // next render after it loads must see it (a few dozen songs at most).
  const data = query.data?.map((shelf) => ({ ...shelf, songs: shelf.songs.filter(allowed) })).filter((shelf) => shelf.songs.length >= MIN_SONGS);
  return { data, isLoading: query.isLoading, isPlaceholderData: query.isPlaceholderData };
}
