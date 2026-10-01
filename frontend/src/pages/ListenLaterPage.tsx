import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import { SongRow, TrackListHead } from '@/components/SongRow';
import { EntityAction, EntityHeader, EntityMeta, GlyphCover, PlayFab, songsLabel, totalDuration } from '@/components/EntityHeader';
import { EmptyState } from '@/components/States';
import { VirtualChunks } from '@/components/VirtualChunks';
import type { Song } from '@/types';
import { BookmarkIcon, QueueIcon } from '@/components/Icons';
import { toast } from '@/store/toastStore';

/** .vx-track-row min-height — the off-screen size estimate for list chunks. */
const ROW_HEIGHT = 60;
const songKey = (song: Song): string => song.id;

/**
 * v5.12.0 — Listen Later. The "I'll come back to this" list: one tap from
 * any song menu, plays or queues in one go, and clears itself as you go.
 * 9.0 "Encore": the Lagoon cover and header; each row keeps its Done pill.
 */
export default function ListenLaterPage() {
  usePageTitle('Listen Later');
  const later = useLibraryStore((s) => s.later);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const enqueueAll = usePlayerStore((s) => s.enqueueAll);

  const renderRow = useCallback(
    (song: Song, i: number) => (
      <div className="vx-row-with">
        <div className="vx-row-main">
          <SongRow song={song} songs={later} index={i} />
        </div>
        <button
          type="button"
          onClick={() => useLibraryStore.getState().toggleLater(song)}
          aria-label={`Remove ${song.title} from Listen Later`}
          title="Done — remove from Listen later"
          className="vx-row-done"
        >
          Done
        </button>
      </div>
    ),
    [later],
  );

  return (
    <div className="vx-entity">
      <EntityHeader
        kind="Playlist"
        title="Listen later"
        tone="var(--tide-500)"
        art={<GlyphCover tone="later" icon={<BookmarkIcon />} />}
        meta={<EntityMeta items={[later.length ? songsLabel(later.length) : 'Songs you want to come back to', totalDuration(later)]} />}
        actions={
          later.length > 0 ? (
            <>
              <PlayFab size="lg" label="Play all" onClick={() => playQueue(later, 0)} />
              <EntityAction
                label="Add to queue"
                onClick={() => {
                  enqueueAll(later);
                  toast(`Queued ${later.length} songs`);
                }}
              >
                <QueueIcon />
              </EntityAction>
            </>
          ) : undefined
        }
      />
      {later.length === 0 ? (
        <EmptyState
          icon={<BookmarkIcon className="w-8 h-8" />}
          title="Nothing saved yet"
          message="Open any song’s ⋯ menu and choose Listen later. It lands here, ready when you are."
          action={<Link to="/" className="px-5 py-2.5 rounded-full btn-primary">Browse music</Link>}
        />
      ) : (
        <div className="vx-tracklist">
          <TrackListHead trail={62} />
          <VirtualChunks items={later} keyOf={songKey} renderItem={renderRow} rowHeight={ROW_HEIGHT} />
        </div>
      )}
    </div>
  );
}
