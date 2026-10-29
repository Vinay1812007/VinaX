import { useInfiniteQuery } from '@tanstack/react-query';
import { getPodcasts, type PodcastSummary } from '@/services/api';
import { usePageTitle } from '@/hooks/usePageTitle';
import { PageHeader } from '@/components/PageHeader';
import { MediaCard } from '@/components/MediaCard';
import { CardGridSkeleton } from '@/components/Skeletons';
import { EmptyState, ErrorState, InlineError } from '@/components/States';
import { InfiniteSentinel } from '@/components/InfiniteSentinel';
import { MicIcon } from '@/components/Icons';
import { Button } from '@/components/Button';
import { podcastPath } from '@/features/podcasts/paths';
import { playPodcast } from '@/features/podcasts/api';
import { bestImage } from '@/utils/images';
import '@/styles/pages/browse.css';

const PAGE_SIZE = 24;

function subtitle(p: PodcastSummary): string {
  const year = p.releaseDate?.slice(0, 4);
  return [p.season && p.season > 1 ? `${p.season} seasons` : 'Podcast', year].filter(Boolean).join(' · ');
}

/**
 * 1.3 — Podcasts: the catalogue's top shows, a page at a time. Each card
 * opens the show at /podcast/:id; its play button starts the latest season.
 */
export default function PodcastsPage() {
  usePageTitle('Podcasts');
  const q = useInfiniteQuery({
    queryKey: ['podcasts', PAGE_SIZE],
    queryFn: ({ pageParam, signal }) => getPodcasts(pageParam, PAGE_SIZE, { signal, priority: 'interactive' }),
    initialPageParam: 1,
    getNextPageParam: (last, all) => (last.length < PAGE_SIZE ? undefined : all.length + 1),
    staleTime: 30 * 60_000,
  });
  // Pages can overlap when the ranking shifts between requests.
  const seen = new Set<string>();
  const shows = (q.data?.pages ?? []).flat().filter((p) => !seen.has(p.id) && (seen.add(p.id), true));
  const nextFailed = q.isFetchNextPageError;

  return (
    <div className="vx-browse vx-browse-page max-w-screen-2xl mx-auto">
      <PageHeader title="Podcasts" subtitle="Conversations, stories and shows, every episode a tap away." />

      {q.isLoading ? (
        <CardGridSkeleton />
      ) : shows.length === 0 && q.isError ? (
        <ErrorState title="Couldn’t load podcasts" retry={() => void q.refetch()} />
      ) : shows.length === 0 ? (
        <EmptyState
          icon={<MicIcon className="w-7 h-7" />}
          title="No podcasts to show right now"
          message="The catalogue sent no shows just now. Try again in a little while."
          action={
            <Button onClick={() => void q.refetch()} className="px-6 min-h-[44px] rounded-full">
              Refresh
            </Button>
          }
        />
      ) : (
        <>
          <div className="vx-card-grid">
            {shows.map((p) => (
              <MediaCard
                key={p.id}
                to={podcastPath(p)}
                image={bestImage(p.images)}
                images={p.images}
                title={p.name}
                subtitle={subtitle(p)}
                fluid
                onPlay={() => void playPodcast(p.id, p.name)}
              />
            ))}
          </div>
          {nextFailed ? (
            <div className="mt-6">
              <InlineError label="more podcasts" retry={() => void q.fetchNextPage()} />
            </div>
          ) : (
            <InfiniteSentinel
              onVisible={() => q.hasNextPage && !q.isFetchingNextPage && void q.fetchNextPage()}
              disabled={!q.hasNextPage}
              loading={q.isFetchingNextPage}
            />
          )}
        </>
      )}
    </div>
  );
}
