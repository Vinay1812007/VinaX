import { useMemo } from 'react';
import { useHistoryStore } from '@/store/historyStore';

export interface ArtistCard {
  id: string;
  name: string;
  image: string | null;
  plays: number;
}

/** Most-played artists derived from local history — powers the Home shelf. */
export function useYourArtists(limit = 10): ArtistCard[] {
  const entries = useHistoryStore((s) => s.entries);
  return useMemo(() => {
    const map = new Map<string, ArtistCard>();
    for (const e of entries) {
      for (const a of e.song.artists.slice(0, 2)) {
        if (!a.name) continue;
        const key = a.id || a.name.toLowerCase();
        const cur = map.get(key) ?? { id: a.id, name: a.name, image: a.image ?? null, plays: 0 };
        cur.plays += 1;
        if (!cur.image && a.image) cur.image = a.image;
        if (!cur.id && a.id) cur.id = a.id;
        map.set(key, cur);
      }
    }
    return [...map.values()].sort((a, b) => b.plays - a.plays).slice(0, limit);
  }, [entries, limit]);
}
