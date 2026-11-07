import { usePageTitle } from '@/hooks/usePageTitle';
import { PageHeader } from '@/components/PageHeader';
import { MediaCard } from '@/components/MediaCard';
import { SectionHeader } from '@/components/SectionHeader';
import { CardGridSkeleton } from '@/components/Skeletons';
import { EmptyState } from '@/components/States';
import { SparkleIcon } from '@/components/Icons';
import { useNewReleasesPage } from '@/features/browse/useBrowseFeeds';
import { usePinnedFeedLangs } from '@/features/home/useCatalogFeeds';
import { useNewForLanguage } from '@/features/home/useHomeShelves';
import { playAlbum } from '@/features/player/playEntity';
import { usePlayerStore } from '@/store/playerStore';
import { languageLabel } from '@/constants/languages';
import { albumPath, songPath } from '@/utils/slug';
import { bestImage } from '@/utils/images';
import type { Song } from '@/types';
import '@/styles/pages/browse.css';

function SongGrid({ songs }: { songs: Song[] }) {
  const playQueue = usePlayerStore((s) => s.playQueue);
  return (
    <div className="vx-card-grid">
      {songs.map((s, i) => (
        <MediaCard key={s.id} to={songPath(s)} image={bestImage(s.images)} images={s.images} title={s.title} subtitle={s.subtitle} song={s} fluid onPlay={() => playQueue(songs, i)} />
      ))}
    </div>
  );
}

/** Mounted only when the catalogue feed failed: the search-based new songs for one language. */
function FallbackSongs({ language }: { language: string }) {
  const q = useNewForLanguage(language);
  if (q.isLoading) return <CardGridSkeleton />;
  if (!q.data?.length) {
    return <EmptyState icon={<SparkleIcon className="w-7 h-7" />} title="No new releases right now" message="Try again in a little while, or pick other music languages." />;
  }
  return (
    <section className="vx-section" aria-label="New this week">
      <SectionHeader title={`New this week in ${languageLabel(language)}`} />
      <SongGrid songs={q.data} />
    </section>
  );
}

/**
 * New Releases: the newest albums and songs in the listener's music
 * languages, from the catalogue's /new-releases. When the catalogue cannot
 * answer, the search-based "new this week" songs for the first language.
 */
export default function NewReleasesPage() {
  usePageTitle('New Releases');
  const langs = usePinnedFeedLangs();
  const feed = useNewReleasesPage();
  const albums = feed.data?.albums ?? [];
  const songs = feed.data?.songs ?? [];
  const subtitle = `The newest music in ${langs.map(languageLabel).join(', ')}.`;

  return (
    <div className="vx-browse vx-browse-page max-w-screen-2xl mx-auto">
      <PageHeader title="New Releases" subtitle={subtitle} />
      {feed.isLoading ? (
        <CardGridSkeleton />
      ) : feed.isError || (albums.length === 0 && songs.length === 0) ? (
        <FallbackSongs language={langs[0] ?? 'hindi'} />
      ) : (
        <>
          {albums.length > 0 && (
            <section className="vx-section" aria-label="New albums">
              <SectionHeader title="New albums" />
              <div className="vx-card-grid">
                {albums.map((a) => (
                  <MediaCard key={a.id} to={albumPath(a)} image={bestImage(a.images)} images={a.images} title={a.title} subtitle={a.subtitle || (a.year ?? 'Album')} fluid onPlay={() => void playAlbum(a.id, a.title)} />
                ))}
              </div>
            </section>
          )}
          {songs.length > 0 && (
            <section className="vx-section" aria-label="New songs">
              <SectionHeader title="New songs" />
              <SongGrid songs={songs} />
            </section>
          )}
        </>
      )}
    </div>
  );
}
