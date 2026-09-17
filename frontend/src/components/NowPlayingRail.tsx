import { lazy, Suspense, useState } from 'react';
import { songLine } from '@/utils/songLine';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { usePlayerStore, useCurrentSong } from '@/store/playerStore';
import { useReasonStore } from '@/store/reasonStore';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import { FavButton } from './FavButton';
import { Marquee } from './Marquee';
import { artistPath } from '@/utils/slug';
import { useSyncedLyrics } from '@/features/lyrics/useSyncedLyrics';
const SyncedLyrics = lazy(() => import('./SyncedLyrics').then(m => ({ default: m.SyncedLyrics })));
import { useMediaQuery } from '@/hooks/useMediaQuery';

/**
 * Persistent Now Playing column on wide screens — artwork, queue preview, one tap to the full player.
 *
 * The rail is only ever visible from the `xl` breakpoint up. CSS-hiding it
 * was not enough: below 1280px it still mounted, fetched synced lyrics, held a
 * playback-clock subscriber and downloaded 500px artwork on every phone. The
 * gate keeps all of that unmounted until the column can actually show.
 */
export function NowPlayingRail() {
  const wide = useMediaQuery('(min-width: 1280px)');
  return wide ? <NowPlayingRailBody /> : null;
}

function NowPlayingRailBody() {
  const [panel, setPanel] = useState<'queue' | 'lyrics'>('queue');
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
      className="vx-playing-rail hidden xl:flex w-80 shrink-0 flex-col gap-4 overflow-y-auto border-l border-glass px-5 pt-6 pb-32"
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
          className="w-full aspect-square object-cover"
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
      <div className="vx-panel-switch" role="group" aria-label="Now playing panel">
        <button type="button" aria-pressed={panel === 'queue'} onClick={() => setPanel('queue')}>Up next</button>
        <button type="button" aria-pressed={panel === 'lyrics'} onClick={() => setPanel('lyrics')}>Lyrics</button>
      </div>
      {panel === 'lyrics' && <section aria-label="Live lyrics" className="vx-rail-lyrics">
        {lyrics.isLoading ? <p className="text-meta text-ink-400" role="status">Finding the words…</p> : lyrics.data?.synced ?
          <Suspense fallback={<p role="status">Loading lyrics…</p>}><SyncedLyrics lines={lyrics.data.synced} live className="max-h-96 overflow-y-auto" /></Suspense> :
          <p className="text-sm text-ink-300 whitespace-pre-wrap leading-7">{lyrics.data?.plain || 'Lyrics aren’t available for this song yet.'}</p>}
        <Link to="/now-playing" className="vx-section-link">Open full player →</Link>
      </section>}
      {panel === 'queue' && upNext.length === 0 && <p className="text-meta text-ink-400">You’re at the end of this queue. Add a song or tune your next mix.</p>}
      {panel === 'queue' && upNext.length > 0 && (
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
                {/* Song – Movie/Album – Artist */}
                <span className="block text-sm truncate">{songLine(s).title}</span>
                <span className="block text-xs text-ink-400 truncate">{[songLine(s).album, songLine(s).artist].filter(Boolean).join(' – ')}</span>
                {reasons[s.id] && <span className="block text-[11px] text-ember-400/80 truncate italic">✨ {reasons[s.id]}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}
