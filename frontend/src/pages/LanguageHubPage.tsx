import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useJsonLd } from '@/hooks/useSeo';
import { SITE_ORIGIN } from '@/utils/schema';
import { albumPath, artistPath, songPath } from '@/utils/slug';
import { searchAlbums, searchArtists } from '@/services/api';
import { MediaCard } from '@/components/MediaCard';
import { bestImage } from '@/utils/images';
import { playAlbum, playArtist } from '@/features/player/playEntity';
import { useNewForLanguage, useTrendingForLanguage } from '@/features/home/useHomeShelves';
import { flattenSongPages, useInfiniteSongs } from '@/features/search/useInfiniteSongs';
import { InfiniteSentinel } from '@/components/InfiniteSentinel';
import { usePlayerStore } from '@/store/playerStore';
import { SongRow } from '@/components/SongRow';
import { ListSkeleton } from '@/components/Skeletons';
import { ErrorState, InlineError } from '@/components/States';
import { HUB_LANGUAGES, languageLabel } from '@/constants/languages';
import type { Song } from '@/types/music';
import { PageHeader } from '@/components/PageHeader';
import { SectionHeader } from '@/components/SectionHeader';
import { Shelf } from '@/components/Shelf';
import { PlayIcon } from '@/components/Icons';
import { HubMoodTiles } from '@/features/discover/HubMoodTiles';
import { LanguageGuide } from '@/features/discover/LanguageGuide';
import '@/styles/pages/browse.css';
import { AdSlot } from '@/components/AdSlot';


function HubSection({ heading, songs, loading, error, retry }: { heading: string; songs: Song[] | undefined; loading: boolean; error: boolean; retry: () => void }) {
  const playQueue = usePlayerStore((s) => s.playQueue);
  return (
    <section className="vx-section">
      <SectionHeader
        title={heading}
        action={(songs?.length ?? 0) > 0 && (
          <button
            type="button"
            onClick={() => {
              if (songs) playQueue(songs, 0);
            }}
            className="vx-pill-btn"
          >
            <PlayIcon /> Play all
          </button>
        )}
      />
      {loading && <ListSkeleton />}
      {/* One section failing is a quiet inline retry; the page-level error
          state is reserved for when nothing on the hub could load. */}
      {error && !songs?.length && <InlineError retry={retry} />}
      <div className="vx-track-list">
        {(songs ?? []).slice(0, 10).map((song, i) => (
          <SongRow key={song.id} song={song} songs={songs ?? []} index={i} />
        ))}
      </div>
    </section>
  );
}

export default function LanguageHubPage({ language }: { language: string }) {
  const label = languageLabel(language);
  const trending = useTrendingForLanguage(language);
  const fresh = useNewForLanguage(language);
  // Package D9 — hub depth: the language's big artists and album hits.
  const artists = useQuery({
    queryKey: ['hub-artists', language],
    queryFn: () => searchArtists(`${label} singers`, 12),
    staleTime: 60 * 60_000,
  });
  const albums = useQuery({
    queryKey: ['hub-albums', language],
    queryFn: () => searchAlbums(`${label} hit albums`, 12),
    staleTime: 60 * 60_000,
  });
  const more = useInfiniteSongs(`${label} songs`);
  const shelfIds = new Set([...(trending.data ?? []), ...(fresh.data ?? [])].map((s) => s.id));
  const moreSongs = flattenSongPages(more.data?.pages).filter((s) => !shelfIds.has(s.id));
  // Both headline shelves failed with nothing cached: say so, once, with a retry
  // (this page used to render its header over a silent blank).
  const shelvesFailed = trending.isError && fresh.isError && !trending.data?.length && !fresh.data?.length;

  usePageMeta({
    title: `${label} Songs — Latest Hits & Trending`,
    description: `Stream the latest ${label} songs free on VinaX — trending hits, new releases and evergreen favourites. No login, private by design.`,
    canonicalPath: `/${language}-songs`,
  });
  useJsonLd(
    (trending.data?.length ?? 0) > 0 && {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: `Trending ${label} Songs`,
      itemListOrder: 'https://schema.org/ItemListOrderDescending',
      numberOfItems: Math.min(trending.data?.length ?? 0, 20),
      itemListElement: (trending.data ?? []).slice(0, 20).map((s, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: `${SITE_ORIGIN}${songPath(s)}`,
      })),
    },
  );

  return (
    <div className="vx-browse vx-browse-page max-w-screen-2xl mx-auto">
      <PageHeader title={`${label} Songs`} />

      {shelvesFailed ? (
        <ErrorState
          retry={() => {
            void trending.refetch();
            void fresh.refetch();
            if (more.isError) void more.refetch();
          }}
        />
      ) : (
        <>
          <HubSection heading="Trending now" songs={trending.data} loading={trending.isLoading} error={trending.isError} retry={() => void trending.refetch()} />
          <HubSection heading="New releases" songs={fresh.data} loading={fresh.isLoading} error={fresh.isError} retry={() => void fresh.refetch()} />
        </>
      )}

      {(artists.data?.length ?? 0) >= 4 && (
        <Shelf title={`Top ${label} artists`}>
          {(artists.data ?? []).map((a) => (
            <MediaCard
              key={a.id}
              to={artistPath(a)}
              image={bestImage(a.images)}
              images={a.images}
              title={a.name}
              subtitle="Artist"
              round
              onPlay={() => void playArtist(a.id, a.name)}
            />
          ))}
        </Shelf>
      )}

      {(albums.data?.length ?? 0) >= 4 && (
        <Shelf title={`${label} albums`}>
          {(albums.data ?? []).map((al) => (
            <MediaCard
              key={al.id}
              to={albumPath(al)}
              image={bestImage(al.images)}
              images={al.images}
              title={al.title}
              subtitle={al.subtitle || 'Album'}
              onPlay={() => void playAlbum(al.id, al.title)}
            />
          ))}
        </Shelf>
      )}

      <section className="vx-section" aria-label={`${label} songs by mood`}>
        <SectionHeader title="Browse by mood" />
        <HubMoodTiles language={language} />
      </section>

      <LanguageGuide language={language} label={label} />
      <AdSlot />

      <section className="vx-section">
        <SectionHeader title={`More ${label} songs`} />
        <div className="vx-track-list">
          {moreSongs.map((song, i) => (
            <SongRow key={song.id} song={song} songs={moreSongs} index={i} />
          ))}
        </div>
        <InfiniteSentinel
          onVisible={() => more.hasNextPage && !more.isFetchingNextPage && more.fetchNextPage()}
          disabled={!more.hasNextPage}
          loading={more.isFetchingNextPage}
        />
      </section>

      <section className="vx-section" aria-label="More languages">
        <SectionHeader title="More languages" />
        <div className="vx-chip-row">
          {HUB_LANGUAGES.filter((l) => l !== language).map((l) => (
            <Link key={l} to={`/${l}-songs`} className="vx-link-chip">
              {languageLabel(l)} songs
            </Link>
          ))}
          <Link to="/moods" className="vx-link-chip">Music by mood</Link>
          <Link to="/movies" className="vx-link-chip">Movie soundtracks</Link>
          <Link to="/charts" className="vx-link-chip">Top charts</Link>
        </div>
      </section>
    </div>
  );
}
