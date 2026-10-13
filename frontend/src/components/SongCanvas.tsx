import { useCallback, useEffect, useRef, useState } from 'react';
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
  onAspect,
}: {
  src: string;
  isPlaying: boolean;
  className?: string;
  onError(): void;
  /** Reports the clip's intrinsic width/height ratio once it is known. */
  onAspect?(aspect: number): void;
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
      onLoadedMetadata={(e) => {
        const v = e.currentTarget;
        if (v.videoWidth > 0 && v.videoHeight > 0) onAspect?.(v.videoWidth / v.videoHeight);
      }}
      className={className}
    />
  );
}

/** Cover overscans a clip by this much before the fit flips to ambient:
 *  a 9:16 canvas still fills a phone edge-to-edge (≈1.2×), while a 16:9
 *  clip on the same phone (≈4×) would be an unwatchable centre crop. */
const AMBIENT_OVERSCAN = 1.45;

/**
 * 13.0.2 — the full-bleed canvas behind the whole player, on every
 * viewport, with Spotify-style auto fit. A clip whose shape is close to
 * the screen's fills it (object-cover, as before). A mismatched clip — a
 * landscape one on a phone, a portrait one on a PC — used to be
 * centre-cropped into a giant face; it now plays whole (object-contain)
 * over a blurred, zoomed copy of ITSELF, so the WHOLE screen is still the
 * moving video, edge to edge, with no bands and no crop. The blurred
 * artwork sits under both as the fallback while the clip loads.
 *
 * The ambient copy is a second <video> on the SAME src — a deliberate,
 * ambient-fit-only exception to the "exactly one <video> decodes" rule:
 * one network fetch (cache-shared), one extra decode of a small preview
 * clip, and it pauses with playback like the sharp one. Mount inside the
 * backdrop layer, UNDER the darkening gradients.
 */
export function SongCanvasBackdrop({ canvas, isPlaying, artUrl }: { canvas: SongCanvasState; isPlaying: boolean; artUrl?: string | null }) {
  const [fit, setFit] = useState<'cover' | 'ambient'>('cover');
  const aspect = useRef(0);
  const compute = useCallback(() => {
    if (!aspect.current) return;
    const view = window.innerWidth / Math.max(1, window.innerHeight);
    const overscan = Math.max(aspect.current / view, view / aspect.current);
    setFit(overscan > AMBIENT_OVERSCAN ? 'ambient' : 'cover');
  }, []);
  // A new clip decides afresh; the screen turning decides again.
  useEffect(() => {
    aspect.current = 0;
    setFit('cover');
    if (!canvas.src) return;
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, [canvas.src, compute]);
  if (!canvas.src) return null;
  // The frame (player.css) sizes the media to the first viewport: the
  // sheet's backdrop is as tall as the whole scrolling page, and without it
  // a contained clip centred itself somewhere down the document. Framed,
  // the canvas fills exactly the screen behind the controls.
  return (
    <div className="vx-np-canvas-frame" aria-hidden>
      {fit === 'ambient' && artUrl && (
        <img
          src={artUrl}
          alt=""
          draggable={false}
          className="absolute inset-0 h-full w-full object-cover scale-110 blur-3xl brightness-[.55] saturate-125"
        />
      )}
      {fit === 'ambient' && (
        <CanvasVideo
          src={canvas.src}
          isPlaying={isPlaying}
          // The ambient copy failing is cosmetic: the artwork under it fills in.
          onError={() => undefined}
          className="absolute inset-0 h-full w-full object-cover scale-110 blur-2xl brightness-[.6] saturate-125"
        />
      )}
      <CanvasVideo
        src={canvas.src}
        isPlaying={isPlaying}
        onError={canvas.markFailed}
        onAspect={(a) => {
          aspect.current = a;
          compute();
        }}
        className={cn('absolute inset-0 h-full w-full', fit === 'ambient' ? 'object-contain' : 'object-cover')}
      />
    </div>
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
