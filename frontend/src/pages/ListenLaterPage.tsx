import { Link } from 'react-router-dom';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import { SongRow } from '@/components/SongRow';
import { PageHeader } from '@/components/PageHeader';
import { PlayIcon, QueueIcon } from '@/components/Icons';
import { toast } from '@/store/toastStore';

/**
 * v5.12.0 — Listen Later. The "I'll come back to this" list: one tap from
 * any song menu, plays or queues in one go, and clears itself as you go.
 */
export default function ListenLaterPage() {
  usePageTitle('Listen Later');
  const later = useLibraryStore((s) => s.later);
  const toggleLater = useLibraryStore((s) => s.toggleLater);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const enqueueAll = usePlayerStore((s) => s.enqueueAll);

  return (
    <div className="max-w-3xl mx-auto vx-stagger">
      <PageHeader
        title="Listen Later"
        subtitle={later.length ? `${later.length} song${later.length === 1 ? '' : 's'} saved for later` : 'Songs you want to come back to'}
        compact
        actions={
          later.length > 0 ? (
            <>
              <button onClick={() => playQueue(later, 0)} className="btn-primary px-4 py-2 text-sm inline-flex items-center gap-1.5">
                <PlayIcon className="w-4 h-4" /> Play all
              </button>
              <button
                onClick={() => {
                  enqueueAll(later);
                  toast(`Queued ${later.length} songs`);
                }}
                className="btn-secondary px-4 py-2 text-sm inline-flex items-center gap-1.5"
              >
                <QueueIcon className="w-4 h-4" /> Add to queue
              </button>
            </>
          ) : undefined
        }
      />
      {later.length === 0 ? (
        <div className="glass-card rounded-2xl p-8 text-center">
          <p className="font-bold">Nothing saved yet</p>
          <p className="text-sm text-ink-400 mt-1">
            Open any song&rsquo;s ⋮ menu and choose <b>Listen later</b>. It lands here, ready when you are.
          </p>
          <Link to="/" className="inline-block mt-4 btn-secondary px-4 py-2 text-sm">Browse music</Link>
        </div>
      ) : (
        <div className="space-y-0.5">
          {later.map((song, i) => (
            <div key={song.id} className="flex items-center gap-1">
              <div className="min-w-0 flex-1">
                <SongRow song={song} songs={later} index={i} />
              </div>
              <button
                onClick={() => toggleLater(song)}
                aria-label={`Remove ${song.title} from Listen Later`}
                className="text-xs font-bold text-ink-400 hover:text-ink-100 px-2 py-2 shrink-0"
              >
                Done
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
