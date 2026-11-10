import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useHistoryStore } from '@/store/historyStore';
import { useSettingsStore } from '@/store/settingsStore';
import { searchSongs } from '@/services/api/saavn';
import { MOMENT_WINDOW_MS, momentLine, momentOf, momentProfile, momentShelfTitle, type MomentProfile } from '@/services/personalization/moments';
import { homeGeneration } from '@/features/home/homeRefresh';
import type { Song } from '@/types';

/**
 * 1.12 — "For your weekday evenings": a Home shelf from the listener's own
 * pattern for this moment (services/personalization/moments): the songs
 * they play most at this time of day, from their history on the device, and
 * one search for the moment's language only when those are too few. Shown
 * only when the pattern is trusted and the listener left "Time and day
 * awareness" on. The moment is the one the Home generation started in, so
 * the shelf never changes under a scrolling thumb.
 */
export interface MomentShelf {
  title: string;
  explanation: string;
  songs: Song[];
}

export function useMomentPattern(): MomentProfile | null {
  const aware = useSettingsStore((s) => s.momentAware);
  const entries = useHistoryStore((s) => s.entries);
  const startedAt = homeGeneration().startedAt;
  return useMemo(() => (aware === false ? null : momentProfile(entries, new Date(startedAt))), [aware, entries, startedAt]);
}

export function useMomentShelf(): { data: MomentShelf | null; isLoading: boolean; pattern: MomentProfile | null } {
  const pattern = useMomentPattern();
  const entries = useHistoryStore((s) => s.entries);
  const on = !!pattern && pattern.confidence >= 0.5;
  // The listener's own plays in this moment, most played first: the shelf
  // costs the catalogue nothing (Home's first paint has a request budget,
  // e2e/home-requests.spec.ts). One search tops it up only when the history
  // alone cannot fill a row.
  const own = useMemo(() => {
    if (!on || !pattern) return [] as Song[];
    const since = Date.now() - MOMENT_WINDOW_MS;
    const plays = new Map<string, { song: Song; n: number }>();
    for (const h of entries) {
      if (!h?.song || typeof h.ts !== 'number' || h.ts < since) continue;
      const m = momentOf(new Date(h.ts));
      if (m.part !== pattern.part || m.weekend !== pattern.weekend) continue;
      const row = plays.get(h.song.id) ?? { song: h.song, n: 0 };
      row.n += h.completed ? 1 : 0.5;
      plays.set(h.song.id, row);
    }
    return [...plays.values()].sort((a, b) => b.n - a.n).slice(0, 15).map((r) => r.song);
  }, [on, pattern, entries]);
  const needFill = on && own.length < 6 && !!pattern?.languages[0];
  const query = useQuery({
    queryKey: ['moment-shelf', pattern?.label ?? '', pattern?.languages[0] ?? ''],
    enabled: needFill,
    staleTime: 30 * 60_000,
    queryFn: ({ signal }): Promise<Song[]> => searchSongs(`${pattern!.languages[0]} ${pattern!.part.replace("-", " ")} songs`, 12, { signal }).catch(() => [] as Song[]),
  });
  if (!on || !pattern) return { data: null, isLoading: false, pattern };
  const seen = new Set(own.map((s) => s.id));
  const songs = needFill ? [...own, ...(query.data ?? []).filter((s) => !seen.has(s.id))].slice(0, 15) : own;
  return {
    data: songs.length >= 4 ? { title: momentShelfTitle(pattern), explanation: momentLine(pattern) ?? '', songs } : null,
    isLoading: needFill && query.isLoading,
    pattern,
  };
}
