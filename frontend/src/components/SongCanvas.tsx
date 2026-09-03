import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Song } from '@/types';
import { findVideoForSong, type Video } from '@/services/api/videos';
import { FALLBACK_ART } from '@/utils/images';
import { cn } from '@/utils/cn';

/**
 * v5.7.11 — the video canvas, responsive the way the big players do it:
 *  - PHONE: the clip fills the WHOLE Now Playing screen as a crisp backdrop
 *    under the darkening gradients, with the still artwork in front — the
 *    immersive mobile-canvas look.
 *  - PC (md+): the clip plays inside the artwork square itself.
 * One state, one decoding <video> at a time (the hook knows the viewport and
 * only the matching surface mounts a player). Artwork is always the poster
 * and instant fallback; the ART/VIDEO toggle is remembered per device.
 */
const CANVAS_OFF_KEY = 'vinax_canvas_off';

function canvasDisabled(): boolean {
  try {
    return localStorage.getItem(CANVAS_OFF_KEY) === '1';
  } catch {
    return false;
  }
}

export interface SongCanvasState {
  video: Video | null;
  /** The playable clip when the canvas should be showing; null when off/failed/none. */
  src: string | null;
  /** A usable clip exists for this song (drives the toggle's visibility). */
  hasVideo: boolean;
  off: boolean;
  isDesktop: boolean;
  toggle(): void;
  markFailed(): void;
}

/** One canvas state for the whole Now Playing screen — call once, share. */
export function useSongCanvas(song: Song | null | undefined): SongCanvasState {
  const [off, setOff] = useState(canvasDisabled);
  const [failedId, setFailedId] = useState<string | null>(null);
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const on = () => setIsDesktop(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const { data } = useQuery({
    queryKey: ['song-canvas', song?.id],
    queryFn: () => findVideoForSong(song as Song),
    enabled: !!song,
    staleTime: 60 * 60_000,
    retry: false,
  });
  const video = data ?? null;
  const failed = !!song && failedId === song.id;
  const hasVideo = !!video?.previewUrl && !failed;
  const src = hasVideo && !off ? video?.previewUrl ?? null : null;
  return {
    video,
    src,
    hasVideo,
    off,
    isDesktop,
    toggle: () => {
      const next = !off;
      setOff(next);
      try {
        if (next) localStorage.setItem(CANVAS_OFF_KEY, '1');
        else localStorage.removeItem(CANVAS_OFF_KEY);
      } catch {
        /* per-device nicety only */
      }
    },
    markFailed: () => {
      if (song) setFailedId(song.id);
    },
  };
}

/** A silently looping clip that breathes with playback. */
function CanvasVideo({
  src,
  poster,
  isPlaying,
  className,
  onError,
}: {
  src: string;
  poster?: string;
  isPlaying: boolean;
  className?: string;
  onError(): void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (isPlaying) void el.play().catch(() => undefined);
    else el.pause();
  }, [isPlaying, src]);
  return (
    <video
      key={src}
      ref={ref}
      src={src}
      poster={poster}
      muted
      loop
      autoPlay
      playsInline
      disablePictureInPicture
      draggable={false}
      onError={onError}
      className={className}
    />
  );
}

/** PHONE surface: the full-bleed canvas behind the whole player. Renders
 *  nothing on desktop (the square owns the clip there) so exactly one
 *  <video> decodes at any moment. Mount inside the backdrop layer, UNDER
 *  the darkening gradients. */
export function SongCanvasBackdrop({ canvas, isPlaying }: { canvas: SongCanvasState; isPlaying: boolean }) {
  if (canvas.isDesktop || !canvas.src) return null;
  return (
    <CanvasVideo
      src={canvas.src}
      isPlaying={isPlaying}
      onError={canvas.markFailed}
      className="absolute inset-0 h-full w-full object-cover"
    />
  );
}

/** The artwork square: on PC it hosts the clip; on phones it stays still
 *  artwork (the backdrop carries the motion) with a soft ring so it reads
 *  cleanly over the moving video. */
export function SongCanvas({
  canvas,
  isPlaying,
  artUrl,
}: {
  canvas: SongCanvasState;
  isPlaying: boolean;
  artUrl: string | null;
}) {
  const baseClasses = cn(
    'relative w-72 h-72 sm:w-80 sm:h-80 rounded-3xl object-cover shadow-[0_28px_70px_-14px_rgb(var(--ember-500)/0.4)] transition-[color,background-color,border-color,opacity,transform] duration-500',
    isPlaying ? 'scale-100' : 'scale-[0.97] opacity-90',
  );
  const videoInSquare = canvas.isDesktop && !!canvas.src;
  return (
    <>
      {videoInSquare ? (
        <CanvasVideo
          src={canvas.src as string}
          poster={artUrl ?? undefined}
          isPlaying={isPlaying}
          onError={canvas.markFailed}
          className={baseClasses}
        />
      ) : (
        <img
          src={artUrl ?? FALLBACK_ART}
          onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)}
          alt=""
          draggable={false}
          className={cn(baseClasses, !canvas.isDesktop && canvas.src && 'ring-1 ring-white/15')}
        />
      )}
      {canvas.hasVideo && (
        <button
          aria-label={canvas.off ? 'Turn the video canvas on' : 'Turn the video canvas off'}
          title={canvas.off ? 'Show video' : 'Show artwork'}
          onClick={canvas.toggle}
          className="absolute top-2.5 right-2.5 z-10 px-2.5 py-1 rounded-full bg-black/55 backdrop-blur text-white text-[10px] font-bold tracking-wide"
        >
          {canvas.off ? '▶ VIDEO' : 'ART'}
        </button>
      )}
    </>
  );
}
