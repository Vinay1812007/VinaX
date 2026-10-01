import { Link, useLocation, useNavigate } from 'react-router-dom';
import { usePlayerStore, useCurrentSong } from '@/store/playerStore';
import { useReasonStore } from '@/store/reasonStore';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import { FavButton } from './FavButton';
import { Marquee } from './Marquee';
import { LiveLyricLine } from './LiveLyricLine';
import { SparkleIcon } from './Icons';
import { artistPath } from '@/utils/slug';
import { useSyncedLyrics } from '@/features/lyrics/useSyncedLyrics';
import { UpNextRows } from '@/features/player/UpNextRows';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import '@/styles/pages/player.css';

/**
 * Persistent Now Playing panel on wide screens — artwork, the song, what
 * plays next (each entry marked "VinaX pick" or "Added by you", in words) and
 * a live lyrics preview; one tap to the full player.
 *
 * The panel is only ever visible from the `xl` breakpoint up. CSS-hiding it
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
  const why = useReasonStore((s) => (song ? s.reasons[song.id] : undefined));
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
    <aside aria-label="Now playing" className="vx-playing-rail vx-rail hidden xl:flex shrink-0 flex-col overflow-y-auto px-5 pt-4 pb-32">
      <div className="vx-rail-head">
        <h2>Now playing</h2>
        <Link to="/now-playing" className="vx-rail-link">Full screen</Link>
      </div>
      <button type="button" onClick={() => navigate('/now-playing')} aria-label="Open full screen player" className="vx-rail-art">
        <img src={bestImage(song.images, 500)} onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)} alt="" />
      </button>
      <div className="vx-rail-now">
        <div className="vx-rail-now-text">
          <Marquee text={song.title} className="vx-rail-title" />
          {song.artists[0]?.id ? (
            <Link to={artistPath(song.artists[0])} className="vx-rail-artist">
              {song.subtitle}
            </Link>
          ) : (
            <p className="vx-rail-artist">{song.subtitle}</p>
          )}
        </div>
        <FavButton song={song} />
      </div>
      {/* Why VinaX chose the playing song, when it recorded a reason. */}
      {why && (
        <p className="vx-rail-why">
          <SparkleIcon />
          <span>{why}</span>
        </p>
      )}

      {/* Up next: a compact list, tap to jump. */}
      <div className="vx-rail-head is-section">
        <h3>Up next</h3>
        <Link to="/queue" className="vx-rail-link">Open queue</Link>
      </div>
      {upNext.length === 0 ? (
        <p className="vx-rail-empty">You’re at the end of this queue. Add a song or tune your next mix.</p>
      ) : (
        <UpNextRows songs={upNext} start={index + 1} variant="rail" />
      )}

      {/* Lyrics preview: the line being sung, tinted by the artwork. */}
      {lyrics.data?.synced ? (
        <section aria-label="Live lyrics" className="mt-6">
          <LiveLyricLine lines={lyrics.data.synced} onOpen={() => navigate('/now-playing')} />
        </section>
      ) : plainPreview && plainPreview.length > 0 ? (
        <section aria-label="Lyrics preview" className="mt-6">
          <Link to={`/lyrics/${song.id}`} className="vx-rail-lyrics-card">
            <span className="vx-rail-lyrics-label">Lyrics</span>
            {plainPreview.map((l, i) => (
              <p key={i} className={i === 0 ? 'is-now truncate' : 'truncate'}>{l}</p>
            ))}
          </Link>
        </section>
      ) : null}
    </aside>
  );
}
