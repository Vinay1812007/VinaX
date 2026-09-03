import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { usePageTitle } from '@/hooks/usePageTitle';
import { getSong } from '@/services/api';
import { getVideo, searchVideos, videoSources } from '@/services/api/videos';
import { usePlayerStore } from '@/store/playerStore';
import { toast } from '@/store/toastStore';
import { VideoCard } from './VideosPage';
import { ListSkeleton } from '@/components/Skeletons';
import { EmptyState } from '@/components/States';
import { PlayIcon } from '@/components/Icons';

/**
 * v5.7.9 — cinematic video player (JioSaavn/Spotify-canvas style): dark
 * immersive stage, autoplay, music pauses the moment the video starts.
 *
 * Source order is honest about the upstream: the FULL stream is tried first
 * (it lights up automatically once the source serves it); the reliably
 * playable 720p preview clip is the fallback, labeled as a preview, with a
 * one-tap bridge to the full audio track through the normal player.
 */
export default function VideoPage() {
  const { id } = useParams();
  const { data: video, isLoading } = useQuery({
    queryKey: ['video', id],
    queryFn: () => getVideo(id ?? ''),
    enabled: !!id,
    staleTime: 30 * 60_000,
  });
  usePageTitle(video ? `${video.title} · Video` : 'Video');

  const videoRef = useRef<HTMLVideoElement>(null);
  const [srcIdx, setSrcIdx] = useState(0);
  const [dead, setDead] = useState(false);
  const sources = video ? videoSources(video) : [];
  const src = sources[srcIdx] ?? null;
  const isPreview = !!video && !!src && src === video.previewUrl && video.streamUrl !== video.previewUrl;

  // New video → start back at the best source.
  useEffect(() => {
    setSrcIdx(0);
    setDead(false);
  }, [id]);

  // The moment the video actually plays, the music steps aside.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const onPlay = () => {
      const st = usePlayerStore.getState();
      if (st.isPlaying) st.togglePlay();
    };
    el.addEventListener('play', onPlay);
    return () => el.removeEventListener('play', onPlay);
  }, [src]);

  const firstArtist = video?.artists[0]?.name ?? '';
  const related = useQuery({
    queryKey: ['videos-related', firstArtist],
    queryFn: () => searchVideos(firstArtist, 0, 9),
    enabled: firstArtist.length > 1,
    staleTime: 10 * 60_000,
  });

  const [songBusy, setSongBusy] = useState(false);
  const playFullSong = async (): Promise<void> => {
    if (!video?.songIds.length || songBusy) return;
    setSongBusy(true);
    try {
      videoRef.current?.pause();
      const song = await getSong(video.songIds[0]);
      usePlayerStore.getState().playSong(song);
    } catch {
      toast('Could not load the full song right now');
    } finally {
      setSongBusy(false);
    }
  };

  if (isLoading) return <ListSkeleton rows={8} />;
  if (!video) {
    return <EmptyState title="Video unavailable" message="This video could not be loaded. It may have been removed from the catalog." />;
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="relative rounded-3xl overflow-hidden bg-black border border-ink-700/40 shadow-2xl">
        {src && !dead ? (
          <video
            key={src}
            ref={videoRef}
            src={src}
            poster={video.thumbnail ?? undefined}
            controls
            autoPlay
            playsInline
            loop={isPreview}
            className="w-full aspect-video bg-black"
            onError={() => {
              // Walk to the next source; past the last one, fail honestly.
              if (srcIdx < sources.length - 1) setSrcIdx((i) => i + 1);
              else setDead(true);
            }}
          />
        ) : (
          <div className="aspect-video grid place-items-center text-center px-6">
            <div>
              <p className="text-ink-200 font-semibold mb-1">This video can’t be played right now</p>
              <p className="text-sm text-ink-400">The video source isn’t serving this title yet — the full song still plays below.</p>
            </div>
          </div>
        )}
        {isPreview && !dead && (
          <span className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-black/70 text-white text-[11px] font-bold tracking-wide">
            PREVIEW
          </span>
        )}
      </div>

      <div className="mt-4 flex items-start gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold truncate">{video.title}</h1>
          <p className="text-sm text-ink-300 truncate">
            {video.subtitle}
            {video.year ? ` · ${video.year}` : ''}
            {video.language ? ` · ${video.language}` : ''}
          </p>
          {isPreview && (
            <p className="text-xs text-ink-400 mt-1.5">
              Showing the official preview clip — the full track plays in the music player.
            </p>
          )}
        </div>
        {video.songIds.length > 0 && (
          <button
            onClick={() => void playFullSong()}
            disabled={songBusy}
            className="flex items-center gap-2 px-5 py-2.5 rounded-full btn-primary text-sm font-bold shrink-0"
          >
            <PlayIcon className="w-4 h-4" /> {songBusy ? 'Loading…' : 'Play full song'}
          </button>
        )}
      </div>

      {related.data && related.data.filter((v) => v.id !== video.id).length > 0 && (
        <section className="mt-10">
          <h2 className="text-lg font-bold mb-3">More from {firstArtist}</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {related.data
              .filter((v) => v.id !== video.id)
              .slice(0, 6)
              .map((v) => (
                <VideoCard key={v.id} v={v} />
              ))}
          </div>
        </section>
      )}

      <p className="mt-8 text-center">
        <Link to="/videos" className="text-sm text-ember-300 hover:underline">
          Browse all videos
        </Link>
      </p>
    </div>
  );
}
