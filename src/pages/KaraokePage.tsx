import { useEffect, useState } from 'react';
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

export default function KaraokePage() {
  usePageTitle('Karaoke');
  const navigate = useNavigate();
  const song = useCurrentSong();
  const lyrics = useSyncedLyrics(song);
  const baseSize = useSettingsStore((s) => s.lyricsSize);
  const karaokeSize = ({ sm: 'md', md: 'lg', lg: 'xl', xl: 'xl' } as const)[baseSize];
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const nextSong = usePlayerStore((s) => s.next);
  const prevSong = usePlayerStore((s) => s.prev);
  const seek = usePlayerStore((s) => s.seek);
  const playSong = usePlayerStore((s) => s.playSong);
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
          action={<Link to="/" className="px-5 py-2.5 rounded-full btn-primary">Browse Home</Link>}
        />
        {recent.length > 0 && (
          <section className="mt-8">
            <h2 className="text-sm font-bold text-ink-200 mb-2.5 px-1">Sing again</h2>
            <div className="space-y-1.5">
              {recent.map(({ song: s }) => (
                <button
                  key={s.id}
                  onClick={() => playSong(s)}
                  className="w-full flex items-center gap-3 glass-card rounded-xl p-2.5 text-left hover:bg-ink-800/40 transition"
                >
                  <img
                    src={bestImage(s.images, 96)}
                    onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)}
                    alt=""
                    loading="lazy"
                    className="w-10 h-10 rounded-lg object-cover shrink-0"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold truncate">{s.title}</span>
                    <span className="block text-xs text-ink-400 truncate">{s.subtitle}</span>
                  </span>
                  <PlayIcon className="w-4 h-4 text-ember-400 ml-auto shrink-0" />
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    );
  }

  const art = bestImage(song.images, 500);

  return createPortal(
    <div className="fixed inset-0 z-[65] flex flex-col bg-ink-950">
      <div className="absolute inset-0 -z-10 overflow-hidden" aria-hidden>
        <img
          src={art}
          onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)}
          alt=""
          className="w-full h-full object-cover scale-125 blur-3xl opacity-40"
        />
        <div className="absolute inset-0 bg-ink-950/82" />
      </div>

      <div className="flex items-center gap-3 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2">
        <button onClick={() => navigate(-1)} aria-label="Close karaoke" className="w-9 h-9 rounded-full flex items-center justify-center text-ink-100 hover:bg-white/10">
          <ChevronDownIcon className="w-6 h-6" />
        </button>
        <div className="min-w-0 flex-1 text-center">
          <p className="text-sm font-bold truncate">{song.title}</p>
          <p className="text-xs text-ink-300 truncate">{song.subtitle} · Karaoke</p>
        </div>
        <span className="w-9 shrink-0" aria-hidden />
      </div>

      <div className="flex-1 overflow-y-auto px-6 no-scrollbar">
        <div className="max-w-xl mx-auto py-[34vh]">
          {lyrics.isLoading ? (
            <p className="text-center text-ink-300">Loading lyrics…</p>
          ) : lyrics.data?.synced ? (
            <SyncedLyrics lines={lyrics.data.synced} live size={karaokeSize} />
          ) : lyrics.data?.plain ? (
            <pre className="whitespace-pre-wrap font-sans text-2xl leading-10 text-ink-100/90">{lyrics.data.plain}</pre>
          ) : (
            <p className="text-center text-ink-300">No lyrics available for this song.</p>
          )}
        </div>
      </div>
      {/* canvas 4b — bottom progress + controls + Meaning */}
      <div className="px-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-2 space-y-4">
        <button
          aria-label="Seek"
          className="relative block w-full h-4 cursor-pointer"
          onClick={(e) => {
            if (duration <= 0) return;
            const r = e.currentTarget.getBoundingClientRect();
            seek(Math.max(0, Math.min(duration, ((e.clientX - r.left) / r.width) * duration)));
          }}
        >
          <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[5px] rounded-full bg-white/[0.12]" />
          <span
            className="absolute left-0 top-1/2 -translate-y-1/2 h-[5px] rounded-full"
            style={{
              width: `${duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0}%`,
              background: 'linear-gradient(90deg, #22d3ee, #60a5fa)',
            }}
          />
        </button>
        <div className="flex items-center justify-between">
          <Link
            to={`/lyrics/${song.id}`}
            className="h-9 px-4 rounded-full bg-white/[0.08] border border-glass-strong text-xs font-extrabold text-ink-200 inline-flex items-center hover:bg-white/15 transition"
          >
            Meaning
          </Link>
          <div className="flex items-center gap-5">
            <button onClick={() => prevSong()} aria-label="Previous song" className="p-2 text-ink-200 hover:text-ink-100 transition">
              <PrevIcon className="w-5 h-5" />
            </button>
            <button
              onClick={togglePlay}
              aria-label={isPlaying ? 'Pause' : 'Play'}
              className="w-[60px] h-[60px] rounded-full bg-premium flex items-center justify-center shadow-lg hover:scale-105 active:scale-95 transition"
            >
              {isPlaying ? <PauseIcon className="w-6 h-6" /> : <PlayIcon className="w-6 h-6" />}
            </button>
            <button onClick={() => nextSong(true)} aria-label="Next song" className="p-2 text-ink-200 hover:text-ink-100 transition">
              <NextIcon className="w-5 h-5" />
            </button>
          </div>
          <span className="w-[76px]" aria-hidden />
        </div>
      </div>
    </div>,
    document.body,
  );
}
