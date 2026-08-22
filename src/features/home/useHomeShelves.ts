import { useQuery } from '@tanstack/react-query';
import { searchSongs, searchSongsPage } from '@/services/api';
import { trendingSeed, timeOfDaySeed, newReleasesSeed, popularSeed } from '@/constants/seeds';
import { rankSongs } from '@/features/search/useSearch';
import { useSettingsStore } from '@/store/settingsStore';
import { useHistoryStore } from '@/store/historyStore';
import type { Song } from '@/types';

export function useTrendingForLanguage(language: string) {
  return useQuery({
    queryKey: ['trending', language],
    queryFn: async () => rankSongs(await searchSongs(trendingSeed(language), 20)),
    staleTime: 15 * 60_000,
  });
}

export function useNewForLanguage(language: string) {
  return useQuery({
    queryKey: ['new-releases-lang', language],
    queryFn: async () => rankSongs(await searchSongs(newReleasesSeed(language), 20)),
    staleTime: 15 * 60_000,
  });
}

/** Refreshing bucket (~every 4h) so home feeds rotate through the day. */
function rotateBucket(): number {
  return Math.floor(Date.now() / (4 * 60 * 60_000));
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

/** Bucketed visit stamp: same value for 15 minutes so a Home revisit within
 *  the window is a cache HIT (no refetch), but the shelf still rotates through
 *  the day. The old per-mount random nonce refetched on every navigation. */
function visitBucket(): number {
  return Math.floor(Date.now() / (15 * 60_000));
}

/** "Trending Now" — across ALL the user's pinned languages, rotating daily. */
export function useTrendingNow() {
  const pinned = useSettingsStore((s) => s.pinnedLanguages);
  const langs = (pinned.length ? pinned : ['hindi']).slice(0, 3);
  const muted = useSettingsStore((s) => s.mutedLanguages);
  const bucket = visitBucket();
  const salt = rotateBucket() + bucket;
  return useQuery({
    queryKey: ['trending-now', langs, muted, bucket],
    queryFn: () => multiLangPool(langs, trendingSeed, salt, muted),
    staleTime: 15 * 60_000,
    gcTime: 30 * 60_000,
  });
}

/** "New Releases" — recent songs across ALL the user's pinned languages. */
export function useNewReleases() {
  const pinned = useSettingsStore((s) => s.pinnedLanguages);
  const langs = (pinned.length ? pinned : ['hindi']).slice(0, 3);
  const muted = useSettingsStore((s) => s.mutedLanguages);
  const bucket = visitBucket();
  const salt = rotateBucket() + bucket;
  return useQuery({
    queryKey: ['new-releases', langs, muted, bucket],
    queryFn: () => multiLangPool(langs, newReleasesSeed, salt, muted),
    staleTime: 15 * 60_000,
    gcTime: 30 * 60_000,
  });
}

/** "Popular" — the most-played songs across the user's pinned languages. */
export function usePopular() {
  const pinned = useSettingsStore((s) => s.pinnedLanguages);
  const langs = (pinned.length ? pinned : ['hindi']).slice(0, 3);
  const muted = useSettingsStore((s) => s.mutedLanguages);
  const bucket = visitBucket();
  const salt = rotateBucket() + bucket;
  return useQuery({
    queryKey: ['popular', langs, muted, bucket],
    queryFn: () => multiLangPool(langs, popularSeed, salt, muted),
    staleTime: 15 * 60_000,
    gcTime: 30 * 60_000,
  });
}

export function useTimeOfDayShelf() {
  const pinned = useSettingsStore((s) => s.pinnedLanguages);
  const lang = pinned[0] ?? 'hindi';
  const hour = new Date().getHours();
  const seed = timeOfDaySeed(hour, lang);
  const query = useQuery({
    queryKey: ['time-of-day', seed.query],
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
