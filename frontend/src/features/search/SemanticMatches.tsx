import { useQuery } from '@tanstack/react-query';
import type { SearchResults } from '@/types';
import { SongRow } from '@/components/SongRow';
import { MediaCard } from '@/components/MediaCard';
import { Shelf } from '@/components/Shelf';
import { ListSkeleton } from '@/components/Skeletons';
import { usePlayerStore } from '@/store/playerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { playArtist, playPlaylist } from '@/features/player/playEntity';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import { letterAvatar } from '@/utils/avatar';
import { artistPath, playlistPath } from '@/utils/slug';
import { explainMatches, findSemanticMatches } from './semanticSearch';
import { SEARCH_GC_MS, SEARCH_STALE_MS } from './useSearch';

/**
 * 8.2.0 — "Songs that match": the natural-language section of Search.
 * Lazily loaded by the Search page only when the query reads like a
 * description; renders nothing when nothing fits (the ordinary results
 * below stay the search).
 */
export default function SemanticMatches({ query, results }: { query: string; results: SearchResults | null }) {
  const pinned = useSettingsStore((s) => s.pinnedLanguages);
  const muted = useSettingsStore((s) => s.mutedLanguages);
  const kid = useSettingsStore((s) => s.kidMode);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const matches = useQuery({
    queryKey: ['search-semantic', query, pinned.join(','), [...muted].sort().join(','), kid ? 1 : 0],
    staleTime: SEARCH_STALE_MS,
    gcTime: SEARCH_GC_MS,
    queryFn: ({ signal }) => findSemanticMatches(query, { results, pinned, muted, signal }),
    retry: false,
  });

  if (matches.isPending) {
    return (
      <section aria-label="Songs that match" aria-busy="true" className="mb-6">
        <div className="search-section-heading">
          <h2>Songs that match</h2>
        </div>
        <ListSkeleton />
      </section>
    );
  }
  const data = matches.data;
  if (!data || !data.songs.length) return null;

  return (
    <div className="mb-6">
      <section aria-label="Songs that match">
        <div className="search-section-heading">
          <h2>Songs that match</h2>
          <button type="button" onClick={() => playQueue(data.songs, 0)}>
            Play all
          </button>
        </div>
        <p className="vx-meta-line mb-2">{explainMatches(query, data.seed)}</p>
        <div className="vx-track-list">
          {data.songs.map((song, i) => (
            <SongRow key={song.id} song={song} songs={data.songs} index={i} />
          ))}
        </div>
      </section>
      {data.artists.length > 0 && (
        <Shelf title="Artists that fit">
          {data.artists.map((a) => {
            const img = a.images?.length ? bestImage(a.images) : a.image || FALLBACK_ART;
            return (
              <MediaCard
                key={a.id}
                to={artistPath(a)}
                image={img === FALLBACK_ART ? letterAvatar(a.name) : img}
                images={a.images}
                title={a.name}
                subtitle="Artist"
                round
                onPlay={() => void playArtist(a.id, a.name)}
              />
            );
          })}
        </Shelf>
      )}
      {data.playlists.length > 0 && (
        <Shelf title="Playlists that fit">
          {data.playlists.map((p) => (
            <MediaCard
              key={p.id}
              to={playlistPath(p)}
              image={bestImage(p.images)}
              images={p.images}
              title={p.title}
              subtitle={p.subtitle}
              onPlay={() => void playPlaylist(p.id, p.title)}
            />
          ))}
        </Shelf>
      )}
    </div>
  );
}
