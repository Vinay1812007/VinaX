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
import { HUB_LANGUAGES, languageLabel } from '@/constants/languages';
import { MOOD_HUBS } from '@/constants/hubs';
import type { Song } from '@/types/music';


function HubSection({ heading, songs, loading }: { heading: string; songs: Song[] | undefined; loading: boolean }) {
  const playQueue = usePlayerStore((s) => s.playQueue);
  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-bold">{heading}</h2>
        {(songs?.length ?? 0) > 0 && (
          <button
            onClick={() => {
              if (songs) playQueue(songs, 0);
            }}
            className="text-xs font-semibold text-ember-400 hover:text-ember-300"
          >
            Play all
          </button>
        )}
      </div>
      {loading && <ListSkeleton />}
      {(songs ?? []).slice(0, 10).map((song, i) => (
        <SongRow key={song.id} song={song} songs={songs ?? []} index={i} />
      ))}
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
    <div className="max-w-4xl mx-auto">
      <header className="mb-7">
        <p className="text-xs uppercase tracking-widest text-ink-400 font-semibold mb-1.5">Language hub</p>
        <h1 className="text-display tracking-tight">{label} Songs</h1>
        <p className="text-sm text-ink-300 mt-2 max-w-2xl">
          The latest {label} hits, fresh releases and all-time favourites — free, no login, tuned to you. Updated
          daily.
        </p>
      </header>

      <HubSection heading="Trending now" songs={trending.data} loading={trending.isLoading} />
      <HubSection heading="New releases" songs={fresh.data} loading={fresh.isLoading} />

      {(artists.data?.length ?? 0) >= 4 && (
        <section className="mb-8">
          <h2 className="text-lg font-bold mb-3">Top {label} artists</h2>
          <div className="flex gap-3 overflow-x-auto no-scrollbar -mx-2 px-2">
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
          </div>
        </section>
      )}

      {(albums.data?.length ?? 0) >= 4 && (
        <section className="mb-8">
          <h2 className="text-lg font-bold mb-3">{label} albums worth an evening</h2>
          <div className="flex gap-3 overflow-x-auto no-scrollbar -mx-2 px-2">
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
          </div>
        </section>
      )}

      <section className="mb-8">
        <h2 className="text-lg font-bold mb-2">More {label} songs</h2>
        {moreSongs.map((song, i) => (
          <SongRow key={song.id} song={song} songs={moreSongs} index={i} />
        ))}
        <InfiniteSentinel
          onVisible={() => more.hasNextPage && !more.isFetchingNextPage && more.fetchNextPage()}
          disabled={!more.hasNextPage}
          loading={more.isFetchingNextPage}
        />
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-bold uppercase tracking-widest text-ink-400 mb-3">{label} songs by mood</h2>
        <div className="flex flex-wrap gap-2 mb-6">
          {MOOD_HUBS.map((m) => (
            <Link key={m.slug} to={`/${language}-${m.slug}-songs`} className="px-3.5 py-2 rounded-full text-xs font-semibold bg-ink-800/70 text-ink-200 border border-glass transition hover:bg-ink-700 hover:text-ink-100">
              {label} {m.label.toLowerCase()} songs
            </Link>
          ))}
        </div>
        <h2 className="text-sm font-bold uppercase tracking-widest text-ink-400 mb-3">More languages</h2>
        <div className="flex flex-wrap gap-2">
          {HUB_LANGUAGES.filter((l) => l !== language).map((l) => (
            <Link
              key={l}
              to={`/${l}-songs`}
              className="px-3.5 py-2 rounded-full text-xs font-semibold bg-ink-800/70 text-ink-200 border border-glass transition hover:bg-ink-700 hover:text-ink-100"
            >
              {languageLabel(l)} songs
            </Link>
          ))}
        </div>
        <p className="text-sm text-ink-400 mt-4">
          Explore more: <Link to="/moods" className="text-ember-400 hover:underline">music by mood</Link> ·{' '}
          <Link to="/movies" className="text-ember-400 hover:underline">movie soundtracks</Link> ·{' '}
          <Link to="/charts" className="text-ember-400 hover:underline">top charts</Link>
        </p>
      </section>
    </div>
  );
}
