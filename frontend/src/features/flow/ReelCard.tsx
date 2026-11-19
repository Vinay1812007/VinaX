import { memo, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Link } from 'react-router-dom';
import { qualityBadge, qualityLabel, type Video } from '@/services/api/videos';
import { autoTarget, availableRenditions, pickRendition, readPreference, writePreference, type QualityPreference, type Rendition } from '@/services/canvas/quality';
import { useLibraryStore } from '@/store/libraryStore';
import { isFavoriteIn } from '@/utils/favIndex';
import { languageLabel } from '@/constants/languages';
import { HeartIcon, MusicIcon, PlayIcon, PlusIcon, ShareIcon, VolumeIcon } from '@/components/Icons';
import { artistPath } from '@/utils/slug';
import { reelSources } from './reels';

/** Two taps closer than this (ms) are a double tap. */
const DOUBLE_TAP_MS = 280;
/** …and closer than this (px). */
const DOUBLE_TAP_PX = 40;

export interface ReelCardProps {
  video: Video;
  index: number;
  total: number;
  /** The reel on screen: it plays. */
  active: boolean;
  /** The reel after it: its clip loads, paused, so the swipe starts at once. */
  next: boolean;
  /** Within a couple of reels of the one on screen: show the thumbnail (the rest stay light). */
  near: boolean;
  muted: boolean;
  reduceMotion: boolean;
  hint: boolean;
  /** The browser refused to start the clip with sound: Flow goes muted and tries again. */
  onAutoplayBlocked: () => void;
  onPlaying: (video: Video) => void;
  onEnded: (video: Video) => void;
  onFailed: (video: Video) => void;
  onToggleMute: () => void;
  onLike: (video: Video) => void;
  onPlaySong: (video: Video) => void;
  onAddToQueue: (video: Video) => void;
  onShare: (video: Video) => void;
}

/**
 * 1.14.4 Flow — one music video, full height, like a reel: the clip in the
 * middle over its own thumbnail blurred, the title and the singers at the
 * bottom, the action rail on the right, a thin progress line along the
 * foot. A tap pauses or plays; a double tap likes the song (a heart blooms
 * where the finger was).
 *
 * 1.17.2 — the rail's Open (to the separate /video/<id> player) is gone:
 * Flow is the one video player now, and /video/<id> opens Flow.
 */
export const ReelCard = memo(function ReelCard(props: ReelCardProps) {
  const { video, index, total, active, next, near, muted, reduceMotion, hint } = props;
  const ref = useRef<HTMLVideoElement>(null);
  // 1.19 — the clip's renditions (4K, 1080p, 720p, 540p… whichever the CDN
  // has), probed once per clip; Auto picks for the screen, or the viewer pins
  // one from the rail and keeps it for every reel.
  const [renditions, setRenditions] = useState<Rendition[] | null>(null);
  const [pref, setPref] = useState<QualityPreference>(readPreference);
  const [qualityOpen, setQualityOpen] = useState(false);
  const resumeAt = useRef(0);
  useEffect(() => {
    if (!near || !video.previewUrl) return;
    let on = true;
    void availableRenditions(video.previewUrl).then((list) => {
      if (on) setRenditions(list);
    });
    return () => {
      on = false;
    };
  }, [near, video.previewUrl]);
  const chosen = renditions ? pickRendition(renditions, pref, autoTarget()) : null;
  const sources = useMemo(() => reelSources(video, chosen?.url ?? null), [video, chosen?.url]);
  const [srcIdx, setSrcIdx] = useState(0);
  // A new choice starts again from its first source, where the clip left off.
  useEffect(() => {
    setSrcIdx(0);
  }, [chosen?.url]);
  const chooseQuality = (p: QualityPreference): void => {
    resumeAt.current = ref.current?.currentTime ?? 0;
    writePreference(p);
    setPref(p);
    setQualityOpen(false);
  };
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  const singleTimer = useRef<number | null>(null);
  const [bursts, setBursts] = useState<Array<{ id: number; x: number; y: number }>>([]);
  const burstSeq = useRef(0);
  const liked = useLibraryStore((s) => video.songIds.some((id) => isFavoriteIn(s.favorites, id)));
  const src = sources[srcIdx] ?? null;
  const mounted = active || next;
  const playingHeight = renditions?.find((r) => r.url === src)?.height ?? 0;
  const pickable = (renditions ?? []).filter((r) => r.height > 0);

  useEffect(() => () => {
    if (singleTimer.current != null) window.clearTimeout(singleTimer.current);
  }, []);

  // On screen: play from the start. Off screen: pause (and start over next time).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.muted = muted;
    if (!active) {
      el.pause();
      if (el.currentTime > 0) el.currentTime = 0;
      setPaused(false);
      setProgress(0);
      return;
    }
    if (paused) return;
    const p = el.play();
    if (p && typeof p.catch === 'function') {
      p.catch((e: unknown) => {
        // NotAllowedError: no sound without a gesture. Anything else is the clip's own error event.
        if (e instanceof DOMException && e.name === 'NotAllowedError' && !el.muted) props.onAutoplayBlocked();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the callbacks are stable
  }, [active, muted, paused, src]);

  const onPointerUp = (e: ReactPointerEvent<HTMLElement>): void => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button, a')) return;
    const now = performance.now();
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const prev = lastTap.current;
    if (prev && now - prev.t < DOUBLE_TAP_MS && Math.hypot(x - prev.x, y - prev.y) < DOUBLE_TAP_PX) {
      lastTap.current = null;
      if (singleTimer.current != null) window.clearTimeout(singleTimer.current);
      singleTimer.current = null;
      props.onLike(video);
      if (!reduceMotion) {
        const id = (burstSeq.current += 1);
        setBursts((b) => [...b, { id, x, y }]);
        window.setTimeout(() => setBursts((b) => b.filter((h) => h.id !== id)), 900);
      }
      return;
    }
    lastTap.current = { t: now, x, y };
    if (singleTimer.current != null) window.clearTimeout(singleTimer.current);
    singleTimer.current = window.setTimeout(() => {
      singleTimer.current = null;
      if (active) setPaused((p) => !p);
    }, DOUBLE_TAP_MS);
  };

  useEffect(() => {
    const el = ref.current;
    if (el && active && paused) el.pause();
  }, [active, paused]);

  const meta = [video.language ? languageLabel(video.language.toLowerCase()) : null, video.year].filter(Boolean).join(' · ');
  const artist = video.artists[0];

  return (
    <article
      className="vx-flow-card vx-reel"
      data-flow-index={index}
      aria-roledescription="video"
      aria-label={`${video.title}${video.subtitle ? ` by ${video.subtitle}` : ''}, ${index + 1} of ${total}`}
      onPointerUp={onPointerUp}
    >
      {near && video.thumbnail && (
        <div className="vx-flow-bg" aria-hidden>
          <img src={video.thumbnail} alt="" decoding="async" />
        </div>
      )}
      <div className="vx-reel-stage">
        {mounted && src ? (
          <video
            key={src}
            ref={ref}
            className="vx-reel-video"
            src={src}
            poster={video.thumbnail ?? undefined}
            muted={muted}
            playsInline
            preload={active ? 'auto' : 'metadata'}
            loop={reduceMotion}
            disablePictureInPicture
            aria-label={`${video.title} video`}
            onLoadedMetadata={(e) => {
              // A quality change remounts the element: carry on where the clip was.
              if (resumeAt.current > 0) {
                try {
                  e.currentTarget.currentTime = resumeAt.current;
                } catch {
                  /* not seekable yet */
                }
                resumeAt.current = 0;
              }
            }}
            onPlaying={() => {
              setPaused(false);
              props.onPlaying(video);
            }}
            onTimeUpdate={(e) => {
              const el = e.currentTarget;
              if (active && el.duration > 0) setProgress(el.currentTime / el.duration);
            }}
            onEnded={() => props.onEnded(video)}
            onError={() => {
              if (srcIdx < sources.length - 1) setSrcIdx((i) => i + 1);
              else props.onFailed(video);
            }}
          />
        ) : near && video.thumbnail ? (
          <img className="vx-reel-video" src={video.thumbnail} alt="" decoding="async" draggable={false} />
        ) : (
          <div className="vx-reel-video is-empty" aria-hidden />
        )}
        {active && paused && (
          <span className="vx-reel-paused" aria-hidden>
            <PlayIcon className="w-10 h-10" />
          </span>
        )}
      </div>

      <div className="vx-reel-bottom">
        <div className="vx-flow-meta">
          <h2 className="vx-flow-title">{video.title}</h2>
          <p className="vx-flow-artists">
            {artist ? <Link to={artistPath(artist)}>{video.subtitle || artist.name}</Link> : video.subtitle}
            {meta && <span className="vx-flow-album"> · {meta}</span>}
          </p>
          {video.songIds.length > 0 && (
            <div className="vx-flow-controls">
              <button type="button" className="vx-flow-full" onClick={() => props.onPlaySong(video)}>
                <MusicIcon className="w-4 h-4" /> Play the song
              </button>
            </div>
          )}
        </div>
        <div className="vx-flow-rail" role="group" aria-label={`Actions for ${video.title}`}>
          {video.songIds.length > 0 && (
            <button
              type="button"
              className={liked ? 'vx-flow-action is-liked' : 'vx-flow-action'}
              aria-label={liked ? `${video.title} is in your favorites` : `Like ${video.title}`}
              aria-pressed={liked}
              onClick={() => props.onLike(video)}
            >
              <HeartIcon key={String(liked)} className={liked ? 'w-6 h-6 heart-pop' : 'w-6 h-6'} filled={liked} />
              <span aria-hidden>{liked ? 'Liked' : 'Like'}</span>
            </button>
          )}
          <button type="button" className="vx-flow-action" aria-label={muted ? 'Turn sound on' : 'Mute'} aria-pressed={!muted} onClick={props.onToggleMute}>
            <VolumeIcon className="w-6 h-6" muted={muted} />
            <span aria-hidden>{muted ? 'Sound off' : 'Sound'}</span>
          </button>
          {video.songIds.length > 0 && (
            <button type="button" className="vx-flow-action" aria-label={`Add ${video.title} to queue`} onClick={() => props.onAddToQueue(video)}>
              <PlusIcon className="w-6 h-6" />
              <span aria-hidden>Queue</span>
            </button>
          )}
          <button type="button" className="vx-flow-action" aria-label={`Share ${video.title}`} onClick={() => props.onShare(video)}>
            <ShareIcon className="w-6 h-6" />
            <span aria-hidden>Share</span>
          </button>
          {pickable.length > 0 && (
            <div className="vx-flow-quality">
              <button
                type="button"
                className="vx-flow-action"
                aria-label={`Video quality: ${pref === 'auto' ? 'Auto' : qualityLabel(pref)}${playingHeight ? `, playing ${qualityLabel(playingHeight)}` : ''}`}
                aria-haspopup="menu"
                aria-expanded={qualityOpen}
                onClick={() => setQualityOpen((o) => !o)}
              >
                <span className="vx-flow-quality-badge" aria-hidden>{playingHeight ? qualityBadge(playingHeight) : 'SD'}</span>
                <span aria-hidden>Quality</span>
              </button>
              {qualityOpen && (
                <div role="menu" aria-label="Video quality" className="vx-flow-quality-menu">
                  <button type="button" role="menuitemradio" aria-checked={pref === 'auto'} onClick={() => chooseQuality('auto')}>
                    Auto{pref === 'auto' && playingHeight ? ` · ${qualityBadge(playingHeight)}` : ''}
                  </button>
                  {pickable.map((r) => (
                    <button key={r.height} type="button" role="menuitemradio" aria-checked={pref === r.height} onClick={() => chooseQuality(r.height)}>
                      {qualityLabel(r.height)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {active && (
        <div className="vx-flow-progress" role="progressbar" aria-label="Video progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
          <span style={{ transform: `scaleX(${progress})` }} />
        </div>
      )}
      {hint && (
        <p className="vx-flow-hint" aria-hidden>
          <span className="vx-flow-hint-chev" />
          <span className="vx-flow-hint-touch">Swipe up for the next video</span>
          <span className="vx-flow-hint-keys">Scroll or press ↓ for the next video</span>
        </p>
      )}
      {bursts.map((b) => (
        <span key={b.id} className="vx-flow-burst" style={{ left: b.x, top: b.y }} aria-hidden>
          <HeartIcon className="w-24 h-24" filled />
        </span>
      ))}
    </article>
  );
});
