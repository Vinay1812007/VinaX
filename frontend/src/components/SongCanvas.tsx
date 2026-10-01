import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Song } from '@/types';
import { findVideoForSong, type Video } from '@/services/api/videos';
import { FALLBACK_ART } from '@/utils/images';
import { cn } from '@/utils/cn';

/**
 * The video canvas on Now Playing — v5.9.0, full-screen model: the
 * clip fills the WHOLE screen behind the player on every device, the
 * artwork card steps aside, and the controls sit over a bottom gradient.
 * (The catalogue's clips are landscape, so a portrait phone shows a
 * centre crop — that is the trade the owner chose over a letterboxed band.)
 * Exactly one <video> ever decodes: the backdrop. The ART/▶VIDEO toggle
 * brings the still artwork back any time and remembers the choice per
 * device.
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

/** The full-bleed canvas behind the whole player, on every viewport. Mount
 *  inside the backdrop layer, UNDER the darkening gradients. */
export function SongCanvasBackdrop({ canvas, isPlaying }: { canvas: SongCanvasState; isPlaying: boolean }) {
  if (!canvas.src) return null;
  return (
    <CanvasVideo
      src={canvas.src}
      isPlaying={isPlaying}
      onError={canvas.markFailed}
      className="absolute inset-0 h-full w-full object-cover"
    />
  );
}

/** The artwork slot: still art normally. While the canvas plays the slot is
 *  empty so the full-screen clip shows through uncovered; the parent pane
 *  keeps the space and hosts the ART/▶VIDEO chip. */
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
  // 8.0 — the artwork fills its column (player.css sizes it); it settles back
  // a little while paused.
  const baseClasses = cn('vx-np-art-img', !isPlaying && 'is-paused');
  // Over the artwork or the clip, so it keeps its own dark chip in every theme (player.css).
  const toggle = canvas.hasVideo && !hideToggle && (
    <button
      type="button"
      aria-label={canvas.off ? 'Turn the video canvas on' : 'Turn the video canvas off'}
      title={canvas.off ? 'Show video' : 'Show artwork'}
      onClick={canvas.toggle}
      className="vx-np-canvas-toggle"
    >
      {canvas.off ? 'Video' : 'Artwork'}
    </button>
  );
  return (
    <>
      {!canvas.src && (
        <img
          src={artUrl ?? FALLBACK_ART}
          onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)}
          alt=""
          draggable={false}
          className={baseClasses}
        />
      )}
      {toggle}
    </>
  );
}
