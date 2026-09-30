import { useQuery } from '@tanstack/react-query';
import type { Artist, ArtistRef } from '@/types';
import { getArtist } from '@/services/api/saavn';
import { artistKey, useLibraryStore } from '@/store/libraryStore';
import { loadProfile } from '@/services/personalization/storage';
import { useYourArtists } from './useYourArtists';

export interface SimilarArtistCard extends ArtistRef {
  /** The artist of yours it came from — the shelf says "Like <name>". */
  because: string;
  /** How many of your artists list it (more is a stronger match). */
  votes: number;
}

const SEEDS = 3;
const LIMIT = 12;

/**
 * 8.5.0 — "Similar artists" for Home. The catalogue's own similar-artist
 * lists for the listener's most-played artists, merged by how many of them
 * name each one. Artists the listener already plays, blocks ("Never play") or
 * has turned down for now ("Less like this") are left out: this shelf is for
 * artists they have not found yet. Only artists the catalogue returned with
 * an id are shown, so every card opens a real artist page.
 */
export function mergeSimilarArtists(
  seeds: Array<Pick<Artist, 'id' | 'name' | 'similarArtists'>>,
  exclude: { knownKeys: Set<string>; hiddenArtists: string[]; softMuted?: Record<string, { until: number }> },
  now = Date.now(),
  limit = LIMIT,
): SimilarArtistCard[] {
  const hidden = new Set(exclude.hiddenArtists);
  const muted = (a: ArtistRef): boolean => {
    const entry = exclude.softMuted?.[a.id] ?? exclude.softMuted?.[a.name.toLowerCase()];
    return !!entry && entry.until > now;
  };
  const merged = new Map<string, SimilarArtistCard & { order: number }>();
  let order = 0;
  for (const seed of seeds) {
    for (const a of seed.similarArtists ?? []) {
      if (!a.id || !a.name) continue;
      const key = artistKey(a.name);
      if (!key || exclude.knownKeys.has(key) || exclude.knownKeys.has(a.id) || hidden.has(key) || muted(a)) continue;
      const cur = merged.get(a.id);
      if (cur) cur.votes += 1;
      else merged.set(a.id, { id: a.id, name: a.name, image: a.image ?? null, because: seed.name, votes: 1, order: order++ });
    }
  }
  return [...merged.values()]
    .sort((x, y) => y.votes - x.votes || x.order - y.order)
    .slice(0, limit)
    .map(({ order: _order, ...card }) => card);
}

export function useSimilarArtists() {
  const yours = useYourArtists(20);
  const hiddenArtists = useLibraryStore((s) => s.hiddenArtists);
  const seedIds = yours.filter((a) => a.id).slice(0, SEEDS).map((a) => a.id as string);
  return useQuery({
    queryKey: ['home-similar-artists', seedIds.join(','), hiddenArtists.join(',')],
    enabled: seedIds.length > 0,
    staleTime: 30 * 60_000,
    queryFn: async (): Promise<SimilarArtistCard[]> => {
      const settled = await Promise.allSettled(seedIds.map((id) => getArtist(id)));
      const seeds = settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
      // Every seed failing is an error the shelf can hide; some failing is just fewer cards.
      if (!seeds.length) throw new Error('similar_artists_unavailable');
      const knownKeys = new Set<string>();
      for (const a of yours) {
        knownKeys.add(artistKey(a.name));
        if (a.id) knownKeys.add(a.id);
      }
      return mergeSimilarArtists(seeds, { knownKeys, hiddenArtists, softMuted: loadProfile().softMuted });
    },
  });
}
