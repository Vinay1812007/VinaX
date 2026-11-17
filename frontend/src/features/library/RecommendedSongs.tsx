import { useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { Song } from '@/types';
import { useLibraryStore } from '@/store/libraryStore';
import { toast } from '@/store/toastStore';
import { useShelfSafety } from '@/features/home/useShelfSafety';
import { SectionHeader } from '@/components/SectionHeader';
import { SongRow } from '@/components/SongRow';
import { ListSkeleton } from '@/components/Skeletons';
import { PlusIcon, RefreshIcon } from '@/components/Icons';
import { fetchPlaylistRecs, visibleRecs } from './playlistRecs';

/**
 * "Recommended songs" at the foot of one of your playlists: about ten songs
 * like the ones in it, each with + to add it. A row tap plays the list from
 * that song; Refresh brings a new set seeded from other songs in the
 * playlist. Catalogue lookups only (./playlistRecs.ts), no AI.
 *
 * Nothing is fetched until the section comes near the screen. What is shown
 * goes through the listener's current safety settings (hidden songs, blocked
 * artists, Kid mode), and a song added to the playlist leaves the list at once.
 */
export function RecommendedSongs({ collectionId, name, songs, hidden = false }: { collectionId: string; name: string; songs: Song[]; hidden?: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const [near, setNear] = useState(false);
  const [round, setRound] = useState(0);
  const shown = useRef(new Set<string>());
  const allowed = useShelfSafety();

  useEffect(() => {
    if (near || hidden) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setNear(true);
    }, { rootMargin: '300px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [near, hidden]);

  const query = useQuery({
    queryKey: ['playlist-recs', collectionId, round],
    enabled: near && songs.length > 0,
    staleTime: Infinity,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => fetchPlaylistRecs(songs, round, shown.current, signal),
  });

  const list = useMemo(() => visibleRecs(query.data ?? [], songs, allowed), [query.data, songs, allowed]);
  useEffect(() => {
    for (const s of list) shown.current.add(s.id);
  }, [list]);

  const add = (song: Song) => {
    const lib = useLibraryStore.getState();
    lib.addToCollection(collectionId, song);
    // Signed out, the add waits for sign-in; say nothing until it lands.
    const now = useLibraryStore.getState().collections.find((c) => c.id === collectionId);
    if (!now?.songs.some((s) => s.id === song.id)) return;
    toast(`Added “${song.title}” to “${name}”`, {
      action: { label: 'Undo', onClick: () => useLibraryStore.getState().removeManyFromCollection(collectionId, [song.id]) },
      duration: 6000,
    });
  };

  const waiting = query.isPending || (query.isPlaceholderData && query.isFetching);

  return (
    <section ref={ref} hidden={hidden} className="vx-esection vx-recs" aria-label="Recommended songs" aria-busy={query.isFetching || undefined}>
      <SectionHeader
        title="Recommended songs"
        explanation="Based on the songs in this playlist"
        action={
          <button
            type="button"
            onClick={() => setRound((r) => r + 1)}
            disabled={!near || query.isFetching}
            aria-label="Refresh recommended songs"
            className="vx-quiet-btn"
          >
            <RefreshIcon className="w-4 h-4" /> Refresh
          </button>
        }
      />
      {waiting && !list.length ? (
        <ListSkeleton rows={5} />
      ) : list.length ? (
        <div className="vx-tracklist">
          {list.map((song, i) => (
            <div key={song.id} className="vx-row-with vx-rec-row">
              <div className="vx-row-main">
                <SongRow song={song} songs={list} index={i} />
              </div>
              <button
                type="button"
                onClick={() => add(song)}
                aria-label={`Add ${song.title} to ${name}`}
                title="Add to playlist"
                className="vx-row-x vx-rec-add"
              >
                <PlusIcon className="w-5 h-5" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="vx-etools-note vx-recs-empty" role="status">No suggestions right now. Try Refresh.</p>
      )}
    </section>
  );
}
