import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Song } from '@/types';
import { findVideoForSong } from '@/services/api/videos';
import { FALLBACK_ART } from '@/utils/images';
import { cn } from '@/utils/cn';

/**
 * v5.7.10 — the video canvas (the Spotify now-playing look): when the playing
 * song has ITS music video in the catalog, the artwork square becomes a
 * silently looping clip while the full track keeps playing in the audio
 * engine. Artwork is always the poster and the instant fallback — a missing
 * or failing video can never blank the player. A small toggle (remembered on
 * this device) turns the canvas off for listeners who prefer still art.
 */
const CANVAS_OFF_KEY = 'vinax_canvas_off';

function canvasDisabled(): boolean {
  try {
    return localStorage.getItem(CANVAS_OFF_KEY) === '1';
  } catch {
    return false;
  }
}

export function SongCanvas({
  song,
  isPlaying,
  artUrl,
}: {
  song: Song;
  isPlaying: boolean;
  artUrl: string | null;
}) {
  const [off, setOff] = useState(canvasDisabled);
  const [failed, setFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const { data: video } = useQuery({
    queryKey: ['song-canvas', song.id],
    queryFn: () => findVideoForSong(song),
    staleTime: 60 * 60_000,
    retry: false,
  });

  // New song → give its video a fresh chance.
  useEffect(() => setFailed(false), [song.id]);

  const src = !off && !failed && video?.previewUrl ? video.previewUrl : null;

  // The canvas breathes with playback: pause the song, the clip freezes too.
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !src) return;
    if (isPlaying) void el.play().catch(() => undefined);
    else el.pause();
  }, [isPlaying, src]);

  const imgClasses = cn(
    'relative w-72 h-72 sm:w-80 sm:h-80 rounded-3xl object-cover shadow-[0_28px_70px_-14px_rgb(var(--ember-500)/0.4)] transition-[color,background-color,border-color,opacity,transform] duration-500',
    isPlaying ? 'scale-100' : 'scale-[0.97] opacity-90',
  );

  return (
    <>
      {src ? (
        <video
          key={src}
          ref={videoRef}
          src={src}
          poster={artUrl ?? undefined}
          muted
          loop
          autoPlay
          playsInline
          disablePictureInPicture
          draggable={false}
          onError={() => setFailed(true)}
          className={imgClasses}
        />
      ) : (
        <img
          src={artUrl ?? FALLBACK_ART}
          onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)}
          alt=""
          draggable={false}
          className={imgClasses}
        />
      )}
      {video?.previewUrl && !failed && (
        <button
          aria-label={off ? 'Turn the video canvas on' : 'Turn the video canvas off'}
          title={off ? 'Show video' : 'Show artwork'}
          onClick={() => {
            const next = !off;
            setOff(next);
            try {
              if (next) localStorage.setItem(CANVAS_OFF_KEY, '1');
              else localStorage.removeItem(CANVAS_OFF_KEY);
            } catch {
              /* per-device nicety only */
            }
          }}
          className="absolute top-2.5 right-2.5 z-10 px-2.5 py-1 rounded-full bg-black/55 backdrop-blur text-white text-[10px] font-bold tracking-wide"
        >
          {off ? '▶ VIDEO' : 'ART'}
        </button>
      )}
    </>
  );
}
