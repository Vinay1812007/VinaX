import { Link, useLocation, useNavigate } from 'react-router-dom';
import { usePlayerStore, useCurrentSong } from '@/store/playerStore';
import { useReasonStore } from '@/store/reasonStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useUiStore } from '@/store/uiStore';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import { songLine } from '@/utils/songLine';
import { FavButton } from './FavButton';
import { Marquee } from './Marquee';
import { LiveLyricLine } from './LiveLyricLine';
import { SparkleIcon, XIcon } from './Icons';
import { IconButton } from './IconButton';
import { artistPath } from '@/utils/slug';
import { useSyncedLyrics } from '@/features/lyrics/useSyncedLyrics';
import { UpNextRows } from '@/features/player/UpNextRows';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import '@/styles/pages/player.css';

/**
 * The right-hand panel on wide screens (1.15 "Now playing view"): the
 * playing song's artwork and title, a lyrics card and the next songs; or,
 * from the player bar's queue button, the queue itself. The player bar's
 * panel switch hides it (settings: nowPlayingView), and so does its ×.
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
  const context = usePlayerStore((s) => s.context);
  const nextRun = usePlayerStore((s) => s.runs[s.index + 1]);
  const autoplay = useSettingsStore((s) => s.autoplay);
  const repeat = usePlayerStore((s) => s.repeat);
  // 1.20.1 — what happens at the end, in the queue's own words.
  const endNote = autoplay && repeat === 'off' ? 'Autoplay plays similar songs when this one ends.' : 'You’re at the end of this queue. Add a song to keep listening.';
  const why = useReasonStore((s) => (song ? s.reasons[song.id] : undefined));
  const view = useUiStore((s) => s.railView);
  const setView = useUiStore((s) => s.setRailView);
  const close = () => useSettingsStore.getState().setNowPlayingView(false);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  // Registered before the early return — hooks must run unconditionally.
  const lyrics = useSyncedLyrics(view === 'playing' ? song : null);
  if (!song || pathname === '/now-playing') return null;

  if (view === 'queue') {
    const upcoming = queue.slice(index + 1, index + 41);
    const line = songLine(song);
    return (
      <aside aria-label="Queue" className="vx-playing-rail vx-rail is-queue shrink-0 flex-col overflow-y-auto">
        <div className="vx-rail-bar">
          <h2>Queue</h2>
          <IconButton size="sm" label="Close the queue" onClick={() => setView('playing')}><XIcon className="w-5 h-5" /></IconButton>
        </div>
        <h3 className="vx-rail-sub">Now playing</h3>
        <div className="vx-upnext-row is-now">
          <img src={bestImage(song.images, 150)} onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)} alt="" />
          <span className="vx-upnext-text">
            <span className="vx-upnext-title">{line.title}</span>
            <span className="vx-upnext-meta">{[line.album, line.artist].filter(Boolean).join(' – ')}</span>
          </span>
        </div>
        <h3 className="vx-rail-sub">{nextRun === 'queued' ? 'Next in queue' : nextRun === 'autoplay' ? 'Autoplay' : context?.label ? `Next from: ${context.label}` : 'Up next'}</h3>
        {upcoming.length === 0 ? (
          <p className="vx-rail-empty">{endNote}</p>
        ) : (
          <UpNextRows songs={upcoming} start={index + 1} variant="rail" />
        )}
        <Link to="/queue" className="vx-rail-more">Open the full queue</Link>
      </aside>
    );
  }

  const upNext = queue.slice(index + 1, index + 4);
  const plainPreview = !lyrics.data?.synced && lyrics.data?.plain
    ? lyrics.data.plain.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 4)
    : null;
  return (
    <aside aria-label="Now playing" className="vx-playing-rail vx-rail shrink-0 flex-col overflow-y-auto">
      <div className="vx-rail-bar">
        {context?.path ? (
          <Link to={context.path} className="vx-rail-context">{context.label}</Link>
        ) : (
          <h2>{context?.label || 'Now playing'}</h2>
        )}
        <IconButton size="sm" label="Hide the Now playing view" onClick={close}><XIcon className="w-5 h-5" /></IconButton>
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

      {/* Lyrics: the line being sung, on the artwork's colour. */}
      {lyrics.data?.synced ? (
        <section aria-label="Live lyrics" className="vx-rail-card is-lyrics">
          <LiveLyricLine lines={lyrics.data.synced} onOpen={() => navigate(`/lyrics/${song.id}`)} />
        </section>
      ) : plainPreview && plainPreview.length > 0 ? (
        <section aria-label="Lyrics preview" className="vx-rail-card is-lyrics">
          <Link to={`/lyrics/${song.id}`} className="vx-rail-lyrics-card">
            <span className="vx-rail-lyrics-label">Lyrics</span>
            {plainPreview.map((l, i) => (
              <p key={i} className={i === 0 ? 'is-now truncate' : 'truncate'}>{l}</p>
            ))}
          </Link>
        </section>
      ) : null}

      {/* Next in queue: a card with the next few songs. */}
      <section aria-label="Next in queue" className="vx-rail-card">
        <div className="vx-rail-head">
          <h3>Next in queue</h3>
          <button type="button" className="vx-rail-link" onClick={() => setView('queue')}>Open queue</button>
        </div>
        {upNext.length === 0 ? (
          <p className="vx-rail-empty">{endNote}</p>
        ) : (
          <UpNextRows songs={upNext} start={index + 1} variant="rail" />
        )}
      </section>
    </aside>
  );
}
