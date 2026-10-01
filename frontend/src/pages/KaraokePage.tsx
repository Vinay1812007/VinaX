import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useCurrentSong, usePlayerStore } from '@/store/playerStore';
import { loadKaraokeHistory, recordKaraokeSession } from '@/features/karaoke/history';
import { PlayIcon, PauseIcon, NextIcon, PrevIcon } from '@/components/Icons';
import { useSyncedLyrics } from '@/features/lyrics/useSyncedLyrics';
import { SyncedLyrics } from '@/components/SyncedLyrics';
import { useSettingsStore } from '@/store/settingsStore';
import { EmptyState } from '@/components/States';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import { ChevronDownIcon, WaveformIcon } from '@/components/Icons';
import { Seekbar } from '@/components/Seekbar';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import '@/styles/pages/player.css';

/**
 * Bottom progress + seek. A leaf on purpose: the playback clock ticks ~4×/s
 * and used to be subscribed at page level, re-rendering the whole lyric list
 * with it. The shared Seekbar owns the clock subscription here, and brings a
 * real slider (arrow keys, Home/End, spoken position) in place of the old
 * click-only strip that keyboard users could not operate. Iris, as on the
 * full-screen player (.vx-np-seek).
 */
function KaraokeProgress() {
  return (
    <div className="vx-np-seek">
      <Seekbar timesBelow remaining />
    </div>
  );
}

export default function KaraokePage() {
  usePageTitle('Karaoke');
  const navigate = useNavigate();
  const song = useCurrentSong();
  const lyrics = useSyncedLyrics(song);
  const baseSize = useSettingsStore((s) => s.lyricsSize);
  const karaokeSize = ({ sm: 'md', md: 'lg', lg: 'xl', xl: 'xl' } as const)[baseSize];
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const { togglePlay, next: nextSong, prev: prevSong, playSong } = usePlayerStore.getState();
  // Full-screen portal = modal: keep Tab inside it (the app shell behind stays
  // mounted), Escape closes, focus returns to whatever opened karaoke.
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, !!song, () => navigate(-1));
  // D10 — remember every karaoke session locally so "Sing again" works.
  const [recent] = useState(loadKaraokeHistory);
  useEffect(() => {
    if (song) recordKaraokeSession(song);
  }, [song?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!song) {
    return (
      <div className="max-w-xl mx-auto">
        <EmptyState
          icon={<WaveformIcon className="w-8 h-8" />}
          title="Nothing playing"
          message="Play a song to start karaoke."
          action={<Link to="/" className="vx-tap px-5 py-2.5 rounded-full btn-primary">Browse Home</Link>}
        />
        {recent.length > 0 && (
          <section className="mt-8" aria-labelledby="vx-karaoke-again">
            <h2 id="vx-karaoke-again" className="text-[17px] font-bold text-ink-100 mb-2 px-1">Sing again</h2>
            <ul className="vx-upnext">
              {recent.map(({ song: s }) => (
                <li key={s.id}>
                  <button type="button" onClick={() => playSong(s)} className="vx-upnext-row">
                    <img
                      src={bestImage(s.images, 96)}
                      onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)}
                      alt=""
                      loading="lazy"
                    />
                    <span className="vx-upnext-text">
                      <span className="vx-upnext-title">{s.title}</span>
                      <span className="vx-upnext-meta">{s.subtitle}</span>
                    </span>
                    <PlayIcon className="w-4 h-4 text-ember-400 shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    );
  }

  const art = bestImage(song.images, 500);

  return createPortal(
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={`Karaoke — ${song.title}`} className="vx-np vx-karaoke">
      <div className="vx-np-bg" aria-hidden>
        <img src={art} onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)} alt="" className="vx-np-bg-art" />
        <div className="vx-np-bg-wash" />
        <div className="vx-karaoke-scrim" />
      </div>

      <div className="vx-karaoke-top">
        <button type="button" onClick={() => navigate(-1)} aria-label="Close karaoke" className="vx-karaoke-close w-11 h-11">
          <ChevronDownIcon className="w-6 h-6" />
        </button>
        <div className="vx-karaoke-heading">
          <p>{song.title}</p>
          <p>{song.subtitle} · Karaoke</p>
        </div>
        <span className="w-11" aria-hidden />
      </div>

      <div className="vx-karaoke-lyrics">
        <div>
          {lyrics.isLoading ? (
            <p className="vx-karaoke-state">Loading lyrics…</p>
          ) : lyrics.data?.synced ? (
            <SyncedLyrics lines={lyrics.data.synced} live size={karaokeSize} />
          ) : lyrics.data?.plain ? (
            <pre className="vx-karaoke-plain">{lyrics.data.plain}</pre>
          ) : (
            <p className="vx-karaoke-state">No lyrics available for this song.</p>
          )}
        </div>
      </div>
      {/* canvas 4b — bottom progress + controls + Meaning */}
      <div className="vx-karaoke-bottom">
        <KaraokeProgress />
        <div className="vx-karaoke-bar">
          <Link to={`/lyrics/${song.id}`} className="vx-np-pill">
            Meaning
          </Link>
          <div className="vx-karaoke-transport">
            <button type="button" onClick={() => prevSong()} aria-label="Previous song" className="vx-karaoke-skip">
              <PrevIcon />
            </button>
            <button type="button" onClick={togglePlay} aria-label={isPlaying ? 'Pause' : 'Play'} className="vx-np-play is-compact">
              {isPlaying ? <PauseIcon /> : <PlayIcon className="vx-np-play-glyph" />}
            </button>
            <button type="button" onClick={() => nextSong(true)} aria-label="Next song" className="vx-karaoke-skip">
              <NextIcon />
            </button>
          </div>
          <span aria-hidden />
        </div>
      </div>
    </div>,
    document.body,
  );
}
