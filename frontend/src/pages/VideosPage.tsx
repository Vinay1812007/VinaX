import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueries, useQuery } from '@tanstack/react-query';
import { usePageTitle } from '@/hooks/usePageTitle';
import { searchVideos, type Video } from '@/services/api/videos';
import { useSettingsStore } from '@/store/settingsStore';
import { loadProfile } from '@/services/personalization/storage';
import { topLanguages } from '@/services/personalization/profile';
import { languageLabel } from '@/constants/languages';
import { PlayIcon, SearchIcon, VideoIcon } from '@/components/Icons';
import { EmptyState, ErrorState, InlineError } from '@/components/States';
import { PageHeader } from '@/components/PageHeader';
import { SectionHeader } from '@/components/SectionHeader';
import '@/styles/pages/browse.css';

function fmtDuration(s: number | null): string {
  if (!s) return '';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/** 16:9 video card — the thumbnail leads (duration in its corner, a play
 *  squircle on hover), then the title on up to two lines and the artists. */
export function VideoCard({ v }: { v: Video }) {
  return (
    <Link to={`/video/${v.id}`} className="bx-video">
      <div className="bx-video-thumb">
        {v.thumbnail ? (
          <img src={v.thumbnail} alt="" loading="lazy" decoding="async" width={320} height={180} />
        ) : (
          <div className="bx-video-none" aria-hidden>
            <VideoIcon />
          </div>
        )}
        <span className="bx-video-play" aria-hidden>
          <PlayIcon />
        </span>
        {v.duration != null && <span className="bx-video-badge">{fmtDuration(v.duration)}</span>}
      </div>
      <p className="bx-video-title">{v.title}</p>
      <p className="bx-video-sub">
        {v.subtitle}
        {v.year ? ` · ${v.year}` : ''}
      </p>
    </Link>
  );
}

function VideoGridSkeleton({ n = 8 }: { n?: number }) {
  return (
    <div className="vx-video-grid">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i}>
          <div className="skeleton aspect-video rounded-card" />
          <div className="skeleton mt-2 h-3.5 w-3/4" />
          <div className="skeleton mt-1.5 h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

/** One shelf's request — shared by the shelf and the page, so both read one cache entry. */
const shelfQuery = (query: string) => ({
  queryKey: ['videos-shelf', query],
  queryFn: () => searchVideos(query, 0, 12),
  staleTime: 10 * 60_000,
});

function VideoShelf({ title, query }: { title: string; query: string }) {
  const { data, isLoading, isError, refetch } = useQuery(shelfQuery(query));
  if (isLoading) {
    return (
      <section className="vx-section">
        <SectionHeader title={title} />
        <VideoGridSkeleton n={4} />
      </section>
    );
  }
  if (isError && !data?.length) {
    return (
      <section className="vx-section">
        <SectionHeader title={title} />
        <InlineError retry={() => void refetch()} />
      </section>
    );
  }
  if (!data?.length) return null;
  return (
    <section className="vx-section">
      <SectionHeader title={title} />
      <div className="vx-video-grid">
        {data.slice(0, 8).map((v) => (
          <VideoCard key={v.id} v={v} />
        ))}
      </div>
    </section>
  );
}

/**
 * v5.7.9 — Music Videos. Search the video catalog and browse per-language
 * shelves; every card opens the cinematic player at /video/:id.
 */
export default function VideosPage() {
  usePageTitle('Videos');
  const pinned = useSettingsStore((s) => s.pinnedLanguages);
  const [langs] = useState<string[]>(() => {
    const fromProfile = topLanguages(loadProfile(), 3).map((l) => l.id);
    const merged = [...new Set([...pinned, ...fromProfile])].slice(0, 3);
    return merged.length ? merged : ['telugu', 'hindi'];
  });
  const shelves = [
    ...langs.map((l) => ({ title: `${languageLabel(l)} video songs`, query: `${l} video songs` })),
    { title: 'Trending videos', query: 'trending video songs' },
  ];
  // Each empty shelf hides itself; when every one came back empty, the page
  // says so instead of showing a blank workspace.
  const shelfResults = useQueries({ queries: shelves.map((sh) => shelfQuery(sh.query)) });
  const allEmpty = shelfResults.every((r) => r.isSuccess && !r.data?.length);
  const [input, setInput] = useState('');
  const [q, setQ] = useState('');
  const search = useQuery({
    queryKey: ['videos-search', q],
    queryFn: () => searchVideos(q, 0, 24),
    enabled: q.trim().length > 1,
    staleTime: 5 * 60_000,
  });

  return (
    <div className="vx-browse vx-browse-page max-w-screen-2xl mx-auto">
      <PageHeader title="Videos" subtitle="Music videos in your languages. Every one opens in its own player." />

      <form
        role="search"
        className="bx-field mb-10 max-w-[720px]"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(input);
        }}
      >
        <SearchIcon />
        <input
          type="search"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Search music videos…"
          aria-label="Search music videos"
          enterKeyHint="search"
        />
      </form>

      {q.trim().length > 1 ? (
        search.isLoading ? (
          <VideoGridSkeleton />
        ) : search.isError ? (
          // A failed search used to read as "No videos found" — wrong, and no way to retry.
          <ErrorState retry={() => void search.refetch()} />
        ) : search.data?.length ? (
          <div className="vx-video-grid">
            {search.data.map((v) => (
              <VideoCard key={v.id} v={v} />
            ))}
          </div>
        ) : (
          <EmptyState icon={<VideoIcon className="w-7 h-7" />} title="No videos found" message={`Nothing matched “${q}”. Try an artist, a film or a song title.`} />
        )
      ) : (
        <>
          {shelves.map((sh) => (
            <VideoShelf key={sh.query} title={sh.title} query={sh.query} />
          ))}
          {allEmpty && (
            <EmptyState
              icon={<VideoIcon className="w-7 h-7" />}
              title="No videos to show right now"
              message="The video catalogue sent nothing for your languages just now. Search for an artist or a film above."
            />
          )}
        </>
      )}
    </div>
  );
}
