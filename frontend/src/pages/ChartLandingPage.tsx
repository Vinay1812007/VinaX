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
import { SectionHeader } from '@/components/SectionHeader';
import { ChevronRightIcon, ShuffleIcon, WaveformIcon } from '@/components/Icons';
import { EntityAction, EntityHeader, EntityMeta, PlayFab, songsLabel } from '@/components/EntityHeader';
import { HubCover } from '@/features/discover/HubCover';
import { shuffledSongs } from '@/features/search/workspace';
import '@/styles/pages/browse.css';

export type ChartVariant = 'top' | 'trending' | 'most-searched';

const YEAR = new Date().getFullYear();

interface VariantConfig {
  path: string;
  h1: string;
  title: string;
  desc: string;
  seed: string;
  listName: string;
  showSearches?: boolean;
}

const CONFIG: Record<ChartVariant, VariantConfig> = {
  top: {
    path: '/top-songs',
    h1: 'Top songs',
    title: 'Top Songs — Most Popular Right Now',
    desc: `The most popular songs on VinaX right now — Telugu, Hindi, Tamil and nine more languages. Stream the top hits free, no login, updated continuously.`,
    seed: `top hit songs india ${YEAR}`,
    listName: 'Top Songs on VinaX',
  },
  trending: {
    path: '/trending',
    h1: 'Trending songs',
    title: 'Trending Songs This Week',
    desc: `Popular Telugu, Hindi, Tamil, Punjabi and more on VinaX, from the catalogue. Free streaming, no login, refreshed continuously.`,
    seed: `trending songs india this week ${YEAR}`,
    listName: 'Trending Songs on VinaX',
  },
  'most-searched': {
    path: '/most-searched',
    h1: 'Most searched songs',
    title: 'Most Searched Songs & Queries',
    desc: `The songs and searches people look for most on VinaX — across Telugu, Hindi, Tamil and more. Discover what everyone is hunting for. Free, no login.`,
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
    <section className="vx-section">
      <SectionHeader title="Trending searches" />
      <div className="vx-chip-row">
        {queries.map((query) => (
          <Link key={query} to={`/search/${encodeURIComponent(query)}`} className="vx-link-chip">
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
    <div className="vx-browse vx-browse-page max-w-screen-2xl mx-auto">
      <Link to="/charts" className="bx-crumb">
        <ChevronRightIcon /> Charts
      </Link>
      <div className="vx-tone-1">
        <EntityHeader
          kind="Chart"
          title={cfg.h1}
          titleText={cfg.h1}
          tone="var(--tone)"
          art={<HubCover songs={songs} icon={<WaveformIcon />} />}
          meta={<EntityMeta items={['From the catalogue', songs.length > 0 && songsLabel(songs.length)]} />}
          actions={
            songs.length > 0 && (
              <>
                <PlayFab label="Play all" onClick={() => playQueue(songs, 0)} />
                <EntityAction label="Shuffle" onClick={() => playQueue(shuffledSongs(songs), 0)}>
                  <ShuffleIcon />
                </EntityAction>
              </>
            )
          }
        />
      </div>

      {cfg.showSearches && <SearchChips />}

      <section className="vx-section">
        {songsQ.isLoading ? (
          <ListSkeleton />
        ) : songsQ.isError ? (
          <ErrorState retry={() => void songsQ.refetch()} />
        ) : (
          <>
            <div className="vx-track-list">
              {songs.map((song, i) => (
                <SongRow key={song.id} song={song} songs={songs} index={i} />
              ))}
            </div>
            <InfiniteSentinel
              onVisible={() => songsQ.hasNextPage && !songsQ.isFetchingNextPage && songsQ.fetchNextPage()}
              disabled={!songsQ.hasNextPage}
              loading={songsQ.isFetchingNextPage}
            />
          </>
        )}
      </section>

      <section className="vx-section" aria-label="Top songs by language">
        <SectionHeader title="Top songs by language" explanation="Every language hub, and the other lists" />
        <div className="vx-chip-row">
          {HUB_LANGUAGES.map((l) => (
            <Link key={l} to={`/${l}-songs`} className="vx-link-chip">
              {languageLabel(l)} songs
            </Link>
          ))}
          <Link to="/top-songs" className="vx-link-chip">Top songs</Link>
          <Link to="/trending" className="vx-link-chip">Trending</Link>
          <Link to="/most-searched" className="vx-link-chip">Most searched</Link>
          <Link to="/discover" className="vx-link-chip">Discover</Link>
          <Link to="/movies" className="vx-link-chip">Movie soundtracks</Link>
        </div>
      </section>
    </div>
  );
}
