import { usePageTitle } from '@/hooks/usePageTitle';
import { PageHeader } from '@/components/PageHeader';
import { MediaCard } from '@/components/MediaCard';
import { CardGridSkeleton } from '@/components/Skeletons';
import { EmptyState } from '@/components/States';
import { ListIcon } from '@/components/Icons';
import { mergeById } from '@/features/browse/useBrowseFeeds';
import {
  playlistSubtitle,
  useChartsFeaturedPlaylists,
  useChartsTrendingPlaylists,
  usePinnedFeedLangs,
} from '@/features/home/useCatalogFeeds';
import { useEditorialPlaylists } from '@/features/discover/useDiscover';
import { playPlaylist } from '@/features/player/playEntity';
import { languageLabel } from '@/constants/languages';
import { playlistPath } from '@/utils/slug';
import { bestImage } from '@/utils/images';
import type { Playlist } from '@/types';
import '@/styles/pages/browse.css';

function PlaylistGrid({ list }: { list: Playlist[] }) {
  return (
    <div className="vx-card-grid">
      {list.map((p) => (
        <MediaCard key={p.id} to={playlistPath(p)} image={bestImage(p.images)} images={p.images} title={p.title} subtitle={playlistSubtitle(p)} fluid onPlay={() => void playPlaylist(p.id, p.title)} />
      ))}
    </div>
  );
}

/** Mounted only when both catalogue feeds failed: playlists found by search. */
function FallbackPlaylists({ language }: { language: string }) {
  const q = useEditorialPlaylists(`${languageLabel(language)} hits`);
  if (q.isLoading) return <CardGridSkeleton />;
  if (!q.data?.length) {
    return <EmptyState icon={<ListIcon className="w-7 h-7" />} title="No playlists to show right now" message="Try again in a little while, or pick other music languages." />;
  }
  return <PlaylistGrid list={q.data} />;
}

/**
 * Top Playlists: the catalogue's trending and featured playlists in the
 * listener's music languages, trending first, each once. Uses the same
 * requests as the Charts page.
 */
export default function TopPlaylistsPage() {
  usePageTitle('Top Playlists');
  const langs = usePinnedFeedLangs();
  const trending = useChartsTrendingPlaylists();
  const featured = useChartsFeaturedPlaylists();
  const list = mergeById(trending.data, featured.data);
  const loading = list.length === 0 && (trending.isLoading || featured.isLoading);

  return (
    <div className="vx-browse vx-browse-page max-w-screen-2xl mx-auto">
      <PageHeader title="Top Playlists" subtitle={`The most played playlists in ${langs.map(languageLabel).join(', ')}.`} />
      {loading ? <CardGridSkeleton /> : list.length > 0 ? <PlaylistGrid list={list} /> : <FallbackPlaylists language={langs[0] ?? 'hindi'} />}
    </div>
  );
}
