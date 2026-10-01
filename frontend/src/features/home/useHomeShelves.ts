import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { searchSongs, searchSongsPage } from '@/services/api';
import { trendingSeed, timeOfDaySeed, newReleasesSeed, popularSeed } from '@/constants/seeds';
import { rankSongs, useRankSettingsKey } from '@/features/search/useSearch';
import { useSettingsStore } from '@/store/settingsStore';
import { useHistoryStore } from '@/store/historyStore';
import type { Song } from '@/types';
import { HOME_TTL_MS, homeGeneration, useHomeGeneration } from './homeRefresh';

// Shelves cache the list AS RANKED, and the ranking reads the muted / pinned
// languages and kid mode — so `rankKey` is part of every key below.
export function useTrendingForLanguage(language: string) {
  const rankKey = useRankSettingsKey();
  return useQuery({
    queryKey: ['trending', language, rankKey],
    queryFn: async () => rankSongs(await searchSongs(trendingSeed(language), 20)),
    staleTime: 15 * 60_000,
  });
}

export function useNewForLanguage(language: string) {
  const rankKey = useRankSettingsKey();
  return useQuery({
    queryKey: ['new-releases-lang', language, rankKey],
    queryFn: async () => rankSongs(await searchSongs(newReleasesSeed(language), 20)),
    staleTime: 15 * 60_000,
  });
}


/** Build a pool across several languages, pulling a rotated page for variety. */
async function multiLangPool(
  langs: string[],
  seedFn: (lang: string, salt: number) => string,
  bucket: number,
  muted: string[] = [],
): Promise<Song[]> {
  const page = 1 + (bucket % 3);
  const batches = await Promise.allSettled(langs.map((l) => searchSongsPage(seedFn(l, bucket), page, 12)));
  const allow = new Set(langs);
  const mute = new Set(muted);
  const seen = new Set<string>();
  const onLang: Song[] = [];
  const spill: Song[] = [];
  for (const b of batches) {
    if (b.status !== 'fulfilled') continue;
    for (const s of b.value) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      if (s.language && mute.has(s.language)) continue; // never surface a muted language
      // A language-targeted search returns many tracks with a missing/'unknown'
      // language tag; treat those as on-language since the query WAS for these
      // languages. Only a *different known* language counts as spill.
      const lang = s.language;
      const known = lang != null && lang !== 'unknown';
      if (!known || (lang != null && allow.has(lang))) onLang.push(s);
      else spill.push(s);
    }
  }
  // Stay in the requested language(s); fall back to mixed only if almost empty.
  return rankSongs(onLang.length >= 4 ? onLang : [...onLang, ...spill]);
}

/**
 * 9.0.0 — the rotation of the multi-language shelves follows the Home
 * generation (./homeRefresh.ts): the same generation reads the same pages, a
 * refresh or a visit after half an hour reads new ones. 8.x keyed them on a
 * 15-minute clock bucket computed at every render, so a shelf could change
 * under a listener who happened to be scrolling Home at a quarter past.
 */
function useRotation(): { gen: number; salt: number } {
  const gen = useHomeGeneration();
  // The 4-hour day-part the generation started in, plus the generation itself.
  const salt = Math.floor(homeGeneration().startedAt / (4 * 60 * 60_000)) + gen;
  return { gen, salt };
}

/** "Trending Now" — across ALL the user's pinned languages, rotating daily. */
export function useTrendingNow() {
  const pinned = useSettingsStore((s) => s.pinnedLanguages);
  const langs = (pinned.length ? pinned : ['hindi']).slice(0, 3);
  const muted = useSettingsStore((s) => s.mutedLanguages);
  const { gen, salt } = useRotation();
  const rankKey = useRankSettingsKey();
  return useQuery({
    queryKey: ['trending-now', langs, muted, gen, rankKey],
    queryFn: () => multiLangPool(langs, trendingSeed, salt, muted),
    staleTime: HOME_TTL_MS,
    gcTime: 2 * HOME_TTL_MS,
    placeholderData: keepPreviousData,
  });
}

/** "New Releases" — recent songs across ALL the user's pinned languages. */
export function useNewReleases() {
  const pinned = useSettingsStore((s) => s.pinnedLanguages);
  const langs = (pinned.length ? pinned : ['hindi']).slice(0, 3);
  const muted = useSettingsStore((s) => s.mutedLanguages);
  const { gen, salt } = useRotation();
  const rankKey = useRankSettingsKey();
  return useQuery({
    queryKey: ['new-releases', langs, muted, gen, rankKey],
    queryFn: () => multiLangPool(langs, newReleasesSeed, salt, muted),
    staleTime: HOME_TTL_MS,
    gcTime: 2 * HOME_TTL_MS,
    placeholderData: keepPreviousData,
  });
}

/** "Popular" — the most-played songs across the user's pinned languages. */
export function usePopular() {
  const pinned = useSettingsStore((s) => s.pinnedLanguages);
  const langs = (pinned.length ? pinned : ['hindi']).slice(0, 3);
  const muted = useSettingsStore((s) => s.mutedLanguages);
  const { gen, salt } = useRotation();
  const rankKey = useRankSettingsKey();
  return useQuery({
    queryKey: ['popular', langs, muted, gen, rankKey],
    queryFn: () => multiLangPool(langs, popularSeed, salt, muted),
    staleTime: HOME_TTL_MS,
    gcTime: 2 * HOME_TTL_MS,
    placeholderData: keepPreviousData,
  });
}

export function useTimeOfDayShelf() {
  const pinned = useSettingsStore((s) => s.pinnedLanguages);
  const lang = pinned[0] ?? 'hindi';
  // 9.0.0 — the hour the generation started, not the hour of this render: the shelf never changes under a scrolling listener.
  const hour = new Date(homeGeneration().startedAt).getHours();
  const seed = timeOfDaySeed(hour, lang);
  const rankKey = useRankSettingsKey();
  const query = useQuery({
    queryKey: ['time-of-day', seed.query, rankKey],
    queryFn: async () => rankSongs(await searchSongs(seed.query, 15)),
    staleTime: 30 * 60_000,
  });
  return { ...query, title: seed.title };
}

/** Unfinished + most recent listens, deduped — "pick up where you left off". */
export function useContinueListening(limit = 12): Song[] {
  const entries = useHistoryStore((s) => s.entries);
  const seen = new Set<string>();
  const out: Song[] = [];
  for (const e of entries) {
    if (seen.has(e.song.id)) continue;
    seen.add(e.song.id);
    out.push(e.song);
    if (out.length >= limit) break;
  }
  return out;
}
