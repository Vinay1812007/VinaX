import { usePageTitle } from '@/hooks/usePageTitle';
import { PageHeader } from '@/components/PageHeader';
import { MediaCard } from '@/components/MediaCard';
import { CardGridSkeleton } from '@/components/Skeletons';
import { EmptyState } from '@/components/States';
import { UsersIcon } from '@/components/Icons';
import { useTrendingArtists } from '@/features/home/useTrendingShelves';
import { usePinnedFeedLangs } from '@/features/home/useCatalogFeeds';
import { playArtist } from '@/features/player/playEntity';
import { languageLabel } from '@/constants/languages';
import { artistPath } from '@/utils/slug';
import { letterAvatar } from '@/utils/avatar';
import '@/styles/pages/browse.css';

/** How many artists the page lists. */
const TOP_ARTISTS = 48;

/**
 * Top Artists: the artists heard most across what is trending in the
 * listener's music languages (the same source as Home's "Trending artists",
 * a longer list). Falls back to catalogue searches when the trending feed is down.
 */
export default function TopArtistsPage() {
  usePageTitle('Top Artists');
  const langs = usePinnedFeedLangs();
  const q = useTrendingArtists(TOP_ARTISTS);
  const artists = q.data;

  return (
    <div className="vx-browse vx-browse-page max-w-screen-2xl mx-auto">
      <PageHeader title="Top Artists" subtitle={`Who everyone is playing in ${langs.map(languageLabel).join(', ')}.`} />
      {q.isLoading ? (
        <CardGridSkeleton />
      ) : artists.length === 0 ? (
        <EmptyState icon={<UsersIcon className="w-7 h-7" />} title="No artists to show right now" message="Try again in a little while, or pick other music languages." />
      ) : (
        <div className="vx-card-grid">
          {artists.map((a) => (
            <MediaCard
              key={a.id || a.name}
              to={a.id ? artistPath(a) : `/search/${encodeURIComponent(a.name)}`}
              image={a.image ?? letterAvatar(a.name)}
              title={a.name}
              subtitle="Artist"
              round
              fluid
              onPlay={a.id ? () => void playArtist(a.id, a.name) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}
