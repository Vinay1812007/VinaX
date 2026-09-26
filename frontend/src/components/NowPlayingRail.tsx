import { songLine } from '@/utils/songLine';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { usePlayerStore, useCurrentSong } from '@/store/playerStore';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import { FavButton } from './FavButton';
import { Marquee } from './Marquee';
import { LiveLyricLine } from './LiveLyricLine';
import { artistPath } from '@/utils/slug';
import { useSyncedLyrics } from '@/features/lyrics/useSyncedLyrics';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import '@/styles/pages/player.css';

/**
 * Persistent Now Playing column on wide screens — artwork, the song, what
 * plays next and a live lyrics preview; one tap to the full player.
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
  const song = useCurrentSong();
  const queue = usePlayerStore((s) => s.queue);
  const index = usePlayerStore((s) => s.index);
  const { playAt } = usePlayerStore.getState();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  // Registered before the early return — hooks must run unconditionally.
  const lyrics = useSyncedLyrics(song);
  if (!song || pathname === '/now-playing') return null;
  const upNext = queue.slice(index + 1, index + 6);
  const plainPreview = !lyrics.data?.synced && lyrics.data?.plain
    ? lyrics.data.plain.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 4)
    : null;
  return (
    <aside
      aria-label="Now playing"
      className="vx-playing-rail vx-rail hidden xl:flex w-80 shrink-0 flex-col overflow-y-auto border-l border-glass px-5 pt-5 pb-32"
    >
      <div className="flex items-center justify-between min-h-[44px] mb-2">
        <h2 className="text-[15px] font-bold text-ink-100">Now playing</h2>
        <Link to="/now-playing" className="vx-rail-link">Full screen</Link>
      </div>
      <button onClick={() => navigate('/now-playing')} aria-label="Open full screen player" className="vx-rail-art">
        <img src={bestImage(song.images, 500)} onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)} alt="" />
      </button>
      <div className="flex items-center justify-between gap-2 mt-4">
        <div className="min-w-0">
          <Marquee text={song.title} className="vx-rail-title" />
          {song.artists[0]?.id ? (
            <Link to={artistPath(song.artists[0])} className="vx-rail-artist">
              {song.subtitle}
            </Link>
          ) : (
            <p className="vx-rail-artist">{song.subtitle}</p>
          )}
        </div>
        <FavButton song={song} className="-mr-2" />
      </div>

      {/* Next in queue: a compact list, tap to jump. */}
      <div className="vx-rail-head">
        <h3>Next in queue</h3>
        <Link to="/queue" className="vx-rail-link">Open queue</Link>
      </div>
      {upNext.length === 0 ? (
        <p className="text-[13px] text-ink-400 py-2">You’re at the end of this queue. Add a song or tune your next mix.</p>
      ) : (
        upNext.map((s, i) => {
          const line = songLine(s);
          return (
            <button key={`${s.id}-${i}`} onClick={() => playAt(index + 1 + i)} className="vx-rail-row">
              <img src={bestImage(s.images, 150)} onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)} alt="" loading="lazy" decoding="async" />
              <span className="min-w-0">
                {/* Song – Movie/Album – Artist */}
                <span className="vx-rail-row-title">{line.title}</span>
                <span className="vx-rail-row-meta">{[line.album, line.artist].filter(Boolean).join(' – ')}</span>
              </span>
            </button>
          );
        })
      )}

      {/* Lyrics preview: the line being sung, tinted by the artwork. */}
      {lyrics.data?.synced ? (
        <section aria-label="Live lyrics" className="mt-6">
          <LiveLyricLine lines={lyrics.data.synced} onOpen={() => navigate('/now-playing')} />
        </section>
      ) : plainPreview && plainPreview.length > 0 ? (
        <section aria-label="Lyrics preview" className="mt-6">
          <Link to={`/lyrics/${song.id}`} className="vx-rail-lyrics-card">
            <span className="block mb-2 text-[13px] font-bold text-ink-100">Lyrics</span>
            {plainPreview.map((l, i) => (
              <p key={i} className={i === 0 ? 'is-now truncate' : 'truncate'}>{l}</p>
            ))}
          </Link>
        </section>
      ) : null}
    </aside>
  );
}
