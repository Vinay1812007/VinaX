import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useHistoryStore } from '@/store/historyStore';
import { useSettingsStore } from '@/store/settingsStore';
import { getArtistTopSongs, searchSongs } from '@/services/api/saavn';
import { momentLine, momentProfile, momentShelfTitle, type MomentProfile } from '@/services/personalization/moments';
import { homeGeneration } from '@/features/home/homeRefresh';
import type { Song } from '@/types';

/**
 * 1.12 — "For your weekday evenings": a Home shelf from the listener's own
 * pattern for this moment (services/personalization/moments). The two
 * artists they play most at this time of day lend their top songs, a search
 * for the moment's first language fills the rest, interleaved so the shelf
 * is not one artist's page. Shown only when the pattern is trusted and the
 * listener left "Time and day awareness" on. The moment is the one the Home
 * generation started in, so the shelf never changes under a scrolling thumb.
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
  const on = !!pattern && pattern.confidence >= 0.5;
  const artistIds = useMemo(() => {
    if (!pattern) return [];
    // Artist ids come from the plays themselves (the pattern keeps names).
    const entries = useHistoryStore.getState().entries;
    const ids: string[] = [];
    for (const a of pattern.artists.slice(0, 2)) {
      const hit = entries.find((h) => (h.song.artists?.[0]?.name ?? '').trim().toLowerCase() === a.key && h.song.artists?.[0]?.id);
      if (hit?.song.artists?.[0]?.id) ids.push(hit.song.artists[0].id);
    }
    return ids;
  }, [pattern]);
  const query = useQuery({
    queryKey: ['moment-shelf', pattern?.label ?? '', artistIds.join(','), pattern?.languages[0] ?? ''],
    enabled: on,
    staleTime: 30 * 60_000,
    queryFn: async (): Promise<Song[]> => {
      const lists = await Promise.all([
        ...artistIds.map((id) => getArtistTopSongs(id).catch(() => [] as Song[])),
        pattern?.languages[0] ? searchSongs(`${pattern.languages[0]} ${pattern.part.replace('-', ' ')} songs`, 12).catch(() => [] as Song[]) : Promise.resolve([] as Song[]),
      ]);
      const out: Song[] = [];
      const seen = new Set<string>();
      for (let i = 0; i < 12; i++) for (const l of lists) { const s = l[i]; if (s && !seen.has(s.id)) { seen.add(s.id); out.push(s); } }
      return out.slice(0, 15);
    },
  });
  if (!on || !pattern) return { data: null, isLoading: false, pattern };
  const songs = query.data ?? [];
  return {
    data: songs.length ? { title: momentShelfTitle(pattern), explanation: momentLine(pattern) ?? '', songs } : null,
    isLoading: query.isLoading,
    pattern,
  };
}
