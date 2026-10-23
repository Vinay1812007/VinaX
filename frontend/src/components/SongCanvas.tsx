import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Song } from '@/types';
import { findVideoForSong, qualityLabel, renditionHeight, type Video } from '@/services/api/videos';
import { autoTarget, availableRenditions, pickRendition, readPreference, writePreference, type QualityPreference, type Rendition } from '@/services/canvas/quality';
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
 *
 * 13.9 — quality. The clip is played at the best rendition the CDN has for
 * this screen (services/canvas/quality): Auto picks for the display, or the
 * listener pins a height from the full-screen view's quality menu. The
 * decoded size is reported back so the badge says what is really playing,
 * and a rendition that fails steps down to the next instead of killing the
 * canvas.
 */
const CANVAS_OFF_KEY = 'vinax_canvas_off';

function canvasDisabled(): boolean {
  try {
    return localStorage.getItem(CANVAS_OFF_KEY) === '1';
  } catch {
    return false;
  }
}

export interface CanvasQuality {
  /** The rendition playing now (null while off or without a clip). */
  height: number | null;
  /** "Full HD 1080p", "540p"… for the rendition playing now. */
  label: string | null;
  /** Every rendition the clip can be played at, highest first. */
  options: Array<{ height: number; label: string }>;
  /** The highest the clip is published in — what "4K" can honestly mean here. */
  best: number | null;
  preference: QualityPreference;
  setPreference(p: QualityPreference): void;
  /** What the decoder actually produced, once known. */
  decoded: { width: number; height: number } | null;
  noteDecoded(width: number, height: number): void;
}

export interface SongCanvasState {
  video: Video | null;
  /** The playable clip when the canvas should be showing; null when off/failed/none. */
  src: string | null;
  /** A usable clip exists for this song (drives the toggle's visibility). */
  hasVideo: boolean;
  off: boolean;
  quality: CanvasQuality;
  toggle(): void;
  markFailed(): void;
}

const NO_OPTIONS: CanvasQuality['options'] = [];

/** One canvas state for the whole Now Playing screen — call once, share. */
export function useSongCanvas(song: Song | null | undefined): SongCanvasState {
  const [off, setOff] = useState(canvasDisabled);
  const [failedId, setFailedId] = useState<string | null>(null);
  // Renditions that would not play for the current clip (by URL), so a failed
  // 1080p steps down to 540p rather than switching the canvas off.
  const [failedHeights, setFailedHeights] = useState<{ url: string; heights: number[] }>({ url: '', heights: [] });
  const [preference, setPref] = useState<QualityPreference>(readPreference);
  const [decoded, setDecoded] = useState<{ width: number; height: number } | null>(null);
  const { data } = useQuery({
    queryKey: ['song-canvas', song?.id],
    queryFn: () => findVideoForSong(song as Song),
    enabled: !!song,
    staleTime: 60 * 60_000,
    retry: false,
  });
  const video = data ?? null;
  const previewUrl = video?.previewUrl ?? null;
  const { data: probed } = useQuery({
    queryKey: ['song-canvas-renditions', previewUrl],
    queryFn: () => availableRenditions(previewUrl as string),
    enabled: !!previewUrl,
    staleTime: 6 * 60 * 60_000,
    retry: false,
  });
  // Until the probe answers, the named rendition alone — playback never waits for it.
  const renditions = useMemo<Rendition[]>(() => {
    if (!previewUrl) return [];
    return probed ?? [{ height: renditionHeight(previewUrl) ?? 0, url: previewUrl }];
  }, [probed, previewUrl]);
  const failed = !!song && failedId === song.id;
  const hasVideo = !!previewUrl && !failed;
  const failedSet = useMemo(() => new Set(failedHeights.url === previewUrl ? failedHeights.heights : []), [failedHeights, previewUrl]);
  const chosen = hasVideo && !off ? pickRendition(renditions, preference, autoTarget(), failedSet) : null;
  const src = chosen?.url ?? null;
  // A new clip (or a new rendition of it) decodes afresh.
  useEffect(() => setDecoded(null), [src]);
  const best = renditions.length ? renditions[0].height : null;
  const quality: CanvasQuality = {
    height: chosen ? chosen.height : null,
    label: chosen && chosen.height > 0 ? qualityLabel(chosen.height) : null,
    options: renditions.length ? renditions.filter((r) => r.height > 0).map((r) => ({ height: r.height, label: qualityLabel(r.height) })) : NO_OPTIONS,
    best: best && best > 0 ? best : null,
    preference,
    setPreference: (p) => {
      setPref(p);
      writePreference(p);
    },
    decoded,
    noteDecoded: (width, height) => setDecoded((d) => (d && d.width === width && d.height === height ? d : { width, height })),
  };
  return {
    video,
    src,
    hasVideo,
    off,
    quality,
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
      if (!song) return;
      // Another rendition is left to try: step down. Otherwise the clip is gone for this song.
      if (chosen && previewUrl && renditions.some((r) => r.height !== chosen.height && !failedSet.has(r.height))) {
        setFailedHeights((f) => ({ url: previewUrl, heights: [...(f.url === previewUrl ? f.heights : []), chosen.height] }));
        return;
      }
      setFailedId(song.id);
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
  /** Reports the clip's intrinsic ratio and size once they are known. */
  onAspect?(aspect: number, width: number, height: number): void;
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
        if (v.videoWidth > 0 && v.videoHeight > 0) onAspect?.(v.videoWidth / v.videoHeight, v.videoWidth, v.videoHeight);
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
        onAspect={(a, w, hgt) => {
          aspect.current = a;
          compute();
          canvas.quality.noteDecoded(w, hgt);
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
