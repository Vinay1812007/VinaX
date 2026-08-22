import { Link, useLocation, useNavigate } from 'react-router-dom';
import { usePlayerStore, useCurrentSong } from '@/store/playerStore';
import { useReasonStore } from '@/store/reasonStore';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import { FavButton } from './FavButton';
import { Marquee } from './Marquee';
import { artistPath } from '@/utils/slug';
import { useSyncedLyrics } from '@/features/lyrics/useSyncedLyrics';
import { LiveLyricLine } from './LiveLyricLine';

/** Persistent Now Playing column on wide screens — artwork, queue preview, one tap to the full player. */
export function NowPlayingRail() {
  const song = useCurrentSong();
  const queue = usePlayerStore((s) => s.queue);
  const index = usePlayerStore((s) => s.index);
  const reasons = useReasonStore((s) => s.reasons);
  const { playAt } = usePlayerStore.getState();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  // Registered before the early return — hooks must run unconditionally.
  const lyrics = useSyncedLyrics(song);
  if (!song || pathname === '/now-playing') return null;
  const upNext = queue.slice(index + 1, index + 6);
  return (
    <aside
      aria-label="Now playing"
      className="hidden xl:flex w-80 shrink-0 flex-col gap-4 overflow-y-auto border-l border-glass px-5 pt-6 pb-32"
    >
      <h2 className="text-xs font-bold uppercase tracking-widest text-ink-400">Now Playing</h2>
      <button
        onClick={() => navigate('/now-playing')}
        aria-label="Open full screen player"
        className="group relative rounded-2xl overflow-hidden shadow-[0_20px_50px_-16px_rgb(var(--ember-500)/0.35)]"
      >
        <img
          src={bestImage(song.images, 500)}
          onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)}
          alt=""
          className="w-full aspect-square object-cover transition-transform duration-500 group-hover:scale-[1.03]"
        />
      </button>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <Marquee text={song.title} className="text-base font-bold" />
          {song.artists[0]?.id ? (
            <Link to={artistPath(song.artists[0])} className="text-sm text-ink-300 truncate block hover:underline">
              {song.subtitle}
            </Link>
          ) : (
            <p className="text-sm text-ink-300 truncate">{song.subtitle}</p>
          )}
        </div>
        <FavButton song={song} />
      </div>
      {lyrics.data?.synced && (
        <LiveLyricLine lines={lyrics.data.synced} onOpen={() => navigate('/now-playing')} />
      )}

      {upNext.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-bold uppercase tracking-widest text-ink-400">Queue</h3>
            <Link to="/queue" className="text-xs font-semibold text-ember-400 hover:text-ember-300">
              Full queue
            </Link>
          </div>
          {upNext.map((s, i) => (
            <button
              key={`${s.id}-${i}`}
              onClick={() => playAt(index + 1 + i)}
              className="w-full flex items-center gap-2.5 px-1.5 py-1.5 rounded-lg hover:bg-ink-800/60 text-left"
            >
              <img
                src={bestImage(s.images, 150)}
                onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)}
                alt=""
                className="w-9 h-9 rounded-md object-cover"
              />
              <span className="min-w-0">
                <span className="block text-sm truncate">{s.title}</span>
                <span className="block text-xs text-ink-400 truncate">{s.subtitle}</span>
                {reasons[s.id] && <span className="block text-[11px] text-ember-400/80 truncate italic">✨ {reasons[s.id]}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}
