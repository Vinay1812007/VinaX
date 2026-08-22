import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useJsonLd } from '@/hooks/useSeo';
import { SITE_ORIGIN } from '@/utils/schema';
import { songPath } from '@/utils/slug';
import { flattenSongPages, useInfiniteSongs } from '@/features/search/useInfiniteSongs';
import { InfiniteSentinel } from '@/components/InfiniteSentinel';
import { usePlayerStore } from '@/store/playerStore';
import { SongRow } from '@/components/SongRow';
import { ListSkeleton } from '@/components/Skeletons';
import { ErrorState } from '@/components/States';
import { HUB_LANGUAGES, languageLabel } from '@/constants/languages';

export type ChartVariant = 'top' | 'trending' | 'most-searched';

const YEAR = new Date().getFullYear();

interface VariantConfig {
  path: string;
  kicker: string;
  h1: string;
  title: string;
  desc: string;
  intro: string;
  seed: string;
  listName: string;
  showSearches?: boolean;
}

const CONFIG: Record<ChartVariant, VariantConfig> = {
  top: {
    path: '/top-songs',
    kicker: 'Charts',
    h1: 'Top Songs',
    title: 'Top Songs — Most Popular Right Now',
    desc: `The most popular songs on VinaX right now — Telugu, Hindi, Tamil and nine more languages. Stream the top hits free, no login, updated continuously.`,
    intro:
      'The biggest songs on VinaX right now, ranked across every language we love. Tap any track to start playing — no account, no ads in the way.',
    seed: `top hit songs india ${YEAR}`,
    listName: 'Top Songs on VinaX',
  },
  trending: {
    path: '/trending',
    kicker: 'Right now',
    h1: 'Trending Songs',
    title: 'Trending Songs This Week',
    desc: `What India is playing this week on VinaX — trending Telugu, Hindi, Tamil, Punjabi and more. Free streaming, no login, refreshed continuously.`,
    intro:
      'The songs climbing fastest across VinaX this week. Fresh momentum, real hits, tuned to what people are actually playing right now.',
    seed: `trending songs india this week ${YEAR}`,
    listName: 'Trending Songs on VinaX',
  },
  'most-searched': {
    path: '/most-searched',
    kicker: 'Popular searches',
    h1: 'Most Searched Songs',
    title: 'Most Searched Songs & Queries',
    desc: `The songs and searches people look for most on VinaX — across Telugu, Hindi, Tamil and more. Discover what everyone is hunting for. Free, no login.`,
    intro:
      'What the VinaX community is searching for most. Popular queries and the songs behind them — a quick way to find what everyone else is discovering.',
    seed: `most searched popular songs india ${YEAR}`,
    listName: 'Most Searched Songs on VinaX',
    showSearches: true,
  },
};

function SearchChips() {
  const q = useQuery({
    queryKey: ['most-searched-queries'],
    queryFn: async (): Promise<string[]> => {
      const r = await fetch('/api/trending-searches');
      if (!r.ok) return [];
      const j = (await r.json()) as { queries?: unknown };
      return Array.isArray(j.queries) ? (j.queries as string[]).filter((s) => typeof s === 'string') : [];
    },
    staleTime: 10 * 60_000,
  });
  const queries = q.data ?? [];
  if (!queries.length) return null;
  return (
    <section className="mb-8">
      <h2 className="text-sm font-bold uppercase tracking-widest text-ink-400 mb-3">Trending searches</h2>
      <div className="flex flex-wrap gap-2">
        {queries.map((query) => (
          <Link
            key={query}
            to={`/search/${encodeURIComponent(query)}`}
            className="px-3.5 py-2 rounded-full text-xs font-semibold bg-ink-800/70 text-ink-200 border border-white/5 transition hover:bg-ink-700 hover:text-ink-100"
          >
            {query}
          </Link>
        ))}
      </div>
    </section>
  );
}

export default function ChartLandingPage({ variant }: { variant: ChartVariant }) {
  const cfg = CONFIG[variant];
  const songsQ = useInfiniteSongs(cfg.seed);
  const songs = flattenSongPages(songsQ.data?.pages);
  const playQueue = usePlayerStore((s) => s.playQueue);

  usePageMeta({ title: cfg.title, description: cfg.desc, canonicalPath: cfg.path });
  useJsonLd(
    songs.length > 0 && {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: cfg.listName,
      itemListOrder: 'https://schema.org/ItemListOrderDescending',
      numberOfItems: Math.min(songs.length, 40),
      itemListElement: songs.slice(0, 40).map((s, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: `${SITE_ORIGIN}${songPath(s)}`,
        item: {
          '@type': 'MusicRecording',
          '@id': `${SITE_ORIGIN}${songPath(s)}#recording`,
          name: s.title,
          url: `${SITE_ORIGIN}${songPath(s)}`,
        },
      })),
    },
  );

  return (
    <div className="max-w-4xl mx-auto">
      <header className="mb-7">
        <p className="text-xs uppercase tracking-widest text-ink-400 font-semibold mb-1.5">{cfg.kicker}</p>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-display tracking-tight">{cfg.h1}</h1>
          {songs.length > 0 && (
            <button
              onClick={() => playQueue(songs, 0)}
              className="h-9 px-4 rounded-full text-xs font-extrabold text-ink-100 border border-ember-400/30"
              style={{ background: 'linear-gradient(135deg, rgba(34,211,238,0.22), rgba(96,165,250,0.14))' }}
            >
              Play all
            </button>
          )}
        </div>
        <p className="text-sm text-ink-300 mt-2 max-w-2xl">{cfg.intro}</p>
      </header>

      {cfg.showSearches && <SearchChips />}

      <section className="mb-8">
        {songsQ.isLoading ? (
          <ListSkeleton />
        ) : songsQ.isError ? (
          <ErrorState retry={() => void songsQ.refetch()} />
        ) : (
          <>
            {songs.map((song, i) => (
              <SongRow key={song.id} song={song} songs={songs} index={i} />
            ))}
            <InfiniteSentinel
              onVisible={() => songsQ.hasNextPage && !songsQ.isFetchingNextPage && songsQ.fetchNextPage()}
              disabled={!songsQ.hasNextPage}
              loading={songsQ.isFetchingNextPage}
            />
          </>
        )}
      </section>

      <section className="mb-8">
        <h2 className="text-sm font-bold uppercase tracking-widest text-ink-400 mb-3">Top songs by language</h2>
        <div className="flex flex-wrap gap-2">
          {HUB_LANGUAGES.map((l) => (
            <Link
              key={l}
              to={`/${l}-songs`}
              className="px-3.5 py-2 rounded-full text-xs font-semibold bg-ink-800/70 text-ink-200 border border-white/5 transition hover:bg-ink-700 hover:text-ink-100"
            >
              {languageLabel(l)} songs
            </Link>
          ))}
        </div>
        <p className="text-sm text-ink-400 mt-4">
          More on VinaX: <Link to="/top-songs" className="text-ember-400 hover:underline">top songs</Link> ·{' '}
          <Link to="/trending" className="text-ember-400 hover:underline">trending</Link> ·{' '}
          <Link to="/most-searched" className="text-ember-400 hover:underline">most searched</Link> ·{' '}
          <Link to="/charts" className="text-ember-400 hover:underline">charts</Link> ·{' '}
          <Link to="/discover" className="text-ember-400 hover:underline">discover</Link> ·{' '}
          <Link to="/movies" className="text-ember-400 hover:underline">movie soundtracks</Link>
        </p>
      </section>
    </div>
  );
}
