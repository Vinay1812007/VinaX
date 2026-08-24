import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Song } from '@/types';
import { searchSongs } from '@/services/api';
import { rankSongs } from '@/features/search/useSearch';
import { useHistoryStore } from '@/store/historyStore';

/**
 * Personalized shelves derived from the local play-history log. These do not
 * hit the network for the base signal — they simply project the store into
 * different lenses (all-time, on-repeat, rewind, recent albums). One shelf
 * (`useBecauseYouListenedTo`) uses a lightweight search to expand a seed.
 *
 * All shelves are UI-driven from the reactive history store, so they update
 * naturally as the user plays songs — no `dailyBucket()` key needed.
 */

const DAY = 86_400_000;

interface Counted {
  song: Song;
  plays: number;
  lastTs: number;
  firstTs: number;
}

function tallyPlays(entries: { song: Song; ts: number }[]): Map<string, Counted> {
  const map = new Map<string, Counted>();
  for (const e of entries) {
    const cur = map.get(e.song.id);
    if (cur) {
      cur.plays += 1;
      if (e.ts > cur.lastTs) cur.lastTs = e.ts;
      if (e.ts < cur.firstTs) cur.firstTs = e.ts;
    } else {
      map.set(e.song.id, { song: e.song, plays: 1, lastTs: e.ts, firstTs: e.ts });
    }
  }
  return map;
}

/** Top 20 songs by all-time local play count. */
export function useMostListened(limit = 20): Song[] {
  const entries = useHistoryStore((s) => s.entries);
  return useMemo(() => {
    const tally = tallyPlays(entries);
    return [...tally.values()]
      .sort((a, b) => b.plays - a.plays || b.lastTs - a.lastTs)
      .slice(0, limit)
      .map((x) => x.song);
  }, [entries, limit]);
}

/** Songs played 3+ times in the last 14 days. */
export function useOnRepeat(limit = 20): Song[] {
  const entries = useHistoryStore((s) => s.entries);
  return useMemo(() => {
    const cutoff = Date.now() - 14 * DAY;
    const recent = entries.filter((e) => e.ts >= cutoff);
    const tally = tallyPlays(recent);
    return [...tally.values()]
      .filter((x) => x.plays >= 3)
      .sort((a, b) => b.plays - a.plays)
      .slice(0, limit)
      .map((x) => x.song);
  }, [entries, limit]);
}

/**
 * "Repeat Rewind" — songs the user loved a long time ago but hasn't touched
 * lately. Fallback per spec: 5+ plays whose most-recent play is older than
 * 60 days, sorted by original play weight.
 */
export function useRepeatRewind(limit = 20): Song[] {
  const entries = useHistoryStore((s) => s.entries);
  return useMemo(() => {
    const now = Date.now();
    const tally = tallyPlays(entries);
    return [...tally.values()]
      .filter((x) => x.plays >= 5 && now - x.lastTs > 60 * DAY)
      .sort((a, b) => b.plays - a.plays)
      .slice(0, limit)
      .map((x) => x.song);
  }, [entries, limit]);
}

/**
 * Unique album names visited recently (in play order). Hydrated via
 * `searchSongs` — one call per album, first 12 unique names, all in flight
 * together with `Promise.allSettled` so a single failure doesn't kill it.
 */
export function useRecentlyPlayedAlbums(limit = 12) {
  const entries = useHistoryStore((s) => s.entries);
  const albumNames = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const e of entries) {
      const name = e.song.album?.name?.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(name);
      if (out.length >= limit) break;
    }
    return out;
  }, [entries, limit]);
  return useQuery({
    queryKey: ['recently-played-albums', albumNames],
    enabled: albumNames.length > 0,
    staleTime: 4 * 60 * 60_000,
    queryFn: async (): Promise<Song[]> => {
      const results = await Promise.allSettled(albumNames.map((q) => searchSongs(q, 6)));
      const seen = new Set<string>();
      const pool: Song[] = [];
      for (const r of results) {
        if (r.status !== 'fulfilled') continue;
        for (const s of r.value) {
          if (seen.has(s.id)) continue;
          seen.add(s.id);
          pool.push(s);
        }
      }
      return rankSongs(pool);
    },
  });
}

/**
 * "Because you listened to …" — an expansion of the user's top artist's
 * signature song. Passes the artist name as the search query and filters
 * the seed itself out of the result.
 */
export function useBecauseYouListenedTo(seed: Song | undefined) {
  const q = seed?.subtitle?.trim() ?? '';
  return useQuery({
    queryKey: ['because-you-listened-to', seed?.id ?? null, q],
    enabled: Boolean(seed && q.length > 1),
    staleTime: 4 * 60 * 60_000,
    queryFn: async (): Promise<Song[]> => {
      const songs = await searchSongs(q, 24);
      return rankSongs(songs).filter((s) => s.id !== seed?.id);
    },
  });
}
