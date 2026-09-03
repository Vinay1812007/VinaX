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
      <div className="relative aspect-video rounded-2xl overflow-hidden bg-ink-850 border border-ink-700/40">
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
          <span className="w-12 h-12 rounded-full bg-white/90 text-ink-950 grid place-items-center text-lg pl-0.5">▶</span>
        </div>
        {v.duration != null && (
          <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded-md bg-black/70 text-white text-[11px] font-semibold tabular-nums">
            {fmtDuration(v.duration)}
          </span>
        )}
      </div>
      <p className="mt-2 text-sm font-semibold text-ink-100 truncate">{v.title}</p>
      <p className="text-xs text-ink-400 truncate">
        {v.subtitle}
        {v.year ? ` · ${v.year}` : ''}
      </p>
    </Link>
  );
}

function VideoGridSkeleton({ n = 8 }: { n?: number }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i}>
          <div className="aspect-video rounded-2xl bg-ink-800/60 animate-pulse" />
          <div className="mt-2 h-3.5 w-3/4 rounded bg-ink-800/60 animate-pulse" />
          <div className="mt-1.5 h-3 w-1/2 rounded bg-ink-800/60 animate-pulse" />
        </div>
      ))}
    </div>
  );
}

function VideoShelf({ title, query }: { title: string; query: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['videos-shelf', query],
    queryFn: () => searchVideos(query, 0, 12),
    staleTime: 10 * 60_000,
  });
  if (isLoading) {
    return (
      <section className="mb-8">
        <h2 className="text-lg font-bold mb-3">{title}</h2>
        <VideoGridSkeleton n={4} />
      </section>
    );
  }
  if (!data?.length) return null;
  return (
    <section className="mb-8">
      <h2 className="text-lg font-bold mb-3">{title}</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
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
    <div>
      <h1 className="text-2xl font-bold mb-1">Videos</h1>
      <p className="text-sm text-ink-300 mb-5">Music videos from the catalog — tap one to watch.</p>

      <form
        className="relative mb-7 max-w-xl"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(input);
        }}
      >
        <SearchIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400 w-4 h-4" />
        <input
          type="search"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Search music videos…"
          className="w-full pl-10 pr-4 py-3 rounded-2xl bg-ink-850/70 border border-ink-700/60 text-sm text-ink-100 placeholder:text-ink-500 focus:outline-none focus:border-ember-500/60"
        />
      </form>

      {q.trim().length > 1 ? (
        search.isLoading ? (
          <VideoGridSkeleton />
        ) : search.data?.length ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
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
