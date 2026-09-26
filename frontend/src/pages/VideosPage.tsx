import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { usePageTitle } from '@/hooks/usePageTitle';
import { searchVideos, type Video } from '@/services/api/videos';
import { useSettingsStore } from '@/store/settingsStore';
import { loadProfile } from '@/services/personalization/storage';
import { topLanguages } from '@/services/personalization/profile';
import { languageLabel } from '@/constants/languages';
import { SearchIcon } from '@/components/Icons';
import { ErrorState, InlineError } from '@/components/States';
import { PageHeader } from '@/components/PageHeader';
import { SectionHeader } from '@/components/SectionHeader';
import '@/styles/pages/browse.css';

function fmtDuration(s: number | null): string {
  if (!s) return '';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/** 16:9 video card — thumbnail with duration badge, title, artists. */
export function VideoCard({ v }: { v: Video }) {
  return (
    <Link to={`/video/${v.id}`} className="group block min-w-0">
      <div className="relative aspect-video rounded-lg overflow-hidden bg-ink-850 shadow-[var(--vx-art-shadow)]">
        {v.thumbnail ? (
          <img
            src={v.thumbnail}
            alt=""
            loading="lazy"
            className="w-full h-full object-cover transition-transform duration-300 motion-safe:group-hover:scale-[1.03]"
          />
        ) : (
          <div className="w-full h-full grid place-items-center text-ink-500 text-3xl">▶</div>
        )}
        <div className="absolute inset-0 grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30">
          <span className="vx-play-fab !w-12 !h-12 text-lg pl-0.5">▶</span>
        </div>
        {v.duration != null && (
          <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded-md bg-black/70 text-white text-[11px] font-semibold tabular-nums">
            {fmtDuration(v.duration)}
          </span>
        )}
      </div>
      <p className="mt-2.5 text-[14px] font-semibold text-ink-100 truncate group-hover:underline underline-offset-2">{v.title}</p>
      <p className="mt-0.5 text-[13px] text-ink-400 truncate">
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
          <div className="skeleton aspect-video rounded-lg" />
          <div className="skeleton mt-2 h-3.5 w-3/4" />
          <div className="skeleton mt-1.5 h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

function VideoShelf({ title, query }: { title: string; query: string }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['videos-shelf', query],
    queryFn: () => searchVideos(query, 0, 12),
    staleTime: 10 * 60_000,
  });
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
      <PageHeader title="Videos" />

      <form
        className="vx-field mb-8 max-w-[720px]"
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
          <p className="text-sm text-ink-400 py-10 text-center">No videos found for “{q}”. Try another search.</p>
        )
      ) : (
        <>
          {langs.map((l) => (
            <VideoShelf key={l} title={`${languageLabel(l)} video songs`} query={`${l} video songs`} />
          ))}
          <VideoShelf title="Trending videos" query="trending video songs" />
        </>
      )}
    </div>
  );
}
