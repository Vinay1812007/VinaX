import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Song } from '@/types';
import { findVideoForSong, type Video } from '@/services/api/videos';
import { FALLBACK_ART } from '@/utils/images';
import { cn } from '@/utils/cn';
import { useIsDesktop } from '@/hooks/useMediaQuery';

/**
 * The video canvas on Now Playing.
 *
 * v5.8.2 — the clips the catalogue serves are LANDSCAPE (1200×540 / 1280×720,
 * 10–30 s loops). Stretched to cover a portrait phone they showed a blurry
 * fifth of the frame, so phones now play the clip the JioSaavn way: at its
 * own aspect ratio, edge to edge, pixel-sharp, in the artwork's place over
 * the ambient backdrop — and in immersive mode centred on black. Desktop
 * screens are landscape too, so there the same clip stays the full-bleed
 * backdrop under the two-column layout (v5.7.12). Exactly one <video> ever
 * decodes: the band on phones, the backdrop on desktop. The ART/▶VIDEO
 * toggle brings the still artwork back any time and remembers the choice
 * per device.
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
  toggle(): void;
  markFailed(): void;
}

/** One canvas state for the whole Now Playing screen — call once, share. */
export function useSongCanvas(song: Song | null | undefined): SongCanvasState {
  const [off, setOff] = useState(canvasDisabled);
  const [failedId, setFailedId] = useState<string | null>(null);
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
  isPlaying,
  className,
  onError,
}: {
  src: string;
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

/** The full-bleed canvas behind the whole player — desktop only (phones get
 *  the band in SongCanvas instead). Mount inside the backdrop layer, UNDER
 *  the darkening gradients. */
export function SongCanvasBackdrop({ canvas, isPlaying }: { canvas: SongCanvasState; isPlaying: boolean }) {
  const desktop = useIsDesktop();
  if (!canvas.src || !desktop) return null;
  return (
    <CanvasVideo
      src={canvas.src}
      isPlaying={isPlaying}
      onError={canvas.markFailed}
      className="absolute inset-0 h-full w-full object-cover"
    />
  );
}

/** The artwork slot: still art normally. While the canvas plays, phones get
 *  the clip itself here — full width at its native aspect ratio, sharp — and
 *  desktop leaves the slot empty so the full-bleed backdrop shows through
 *  (the parent keeps a window of the artwork's size, so the two-column
 *  layout never jumps). */
export function SongCanvas({
  canvas,
  isPlaying,
  artUrl,
  hideToggle = false,
}: {
  canvas: SongCanvasState;
  isPlaying: boolean;
  artUrl: string | null;
  /** Immersive mode: the controls are gone, so the ART/VIDEO chip goes too. */
  hideToggle?: boolean;
}) {
  const desktop = useIsDesktop();
  const baseClasses = cn(
    'w-72 h-72 sm:w-80 sm:h-80 rounded-3xl transition-[color,background-color,border-color,opacity,transform] duration-500',
    isPlaying ? 'scale-100' : 'scale-[0.97] opacity-90',
  );
  const toggle = canvas.hasVideo && !hideToggle && (
    <button
      aria-label={canvas.off ? 'Turn the video canvas on' : 'Turn the video canvas off'}
      title={canvas.off ? 'Show video' : 'Show artwork'}
      onClick={canvas.toggle}
      className="absolute top-2.5 right-2.5 z-10 px-2.5 py-1 rounded-full bg-black/55 backdrop-blur text-white text-[10px] font-bold tracking-wide"
    >
      {canvas.off ? '▶ VIDEO' : 'ART'}
    </button>
  );
  if (canvas.src && !desktop) {
    // The band. Its box is the full pane width; the clip letterboxes inside
    // at its own ratio, so a 16:9 and a 20:9 clip both stay pixel-sharp.
    return (
      <div className="relative w-full max-h-full flex items-center justify-center">
        <CanvasVideo
          src={canvas.src}
          isPlaying={isPlaying}
          onError={canvas.markFailed}
          className="w-full max-h-full object-contain"
        />
        {toggle}
      </div>
    );
  }
  return (
    <>
      {!canvas.src && (
        <img
          src={artUrl ?? FALLBACK_ART}
          onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)}
          alt=""
          draggable={false}
          className={cn(baseClasses, 'object-cover shadow-[0_28px_70px_-14px_rgb(var(--ember-500)/0.4)]')}
        />
      )}
      {toggle}
    </>
  );
}
