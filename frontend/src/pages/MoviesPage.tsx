import { useState } from 'react';
import { Link } from 'react-router-dom';
import { albumPath } from '@/utils/slug';
import { filmTitleFromAlbumName } from '@/services/api/movies';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { MediaCard } from '@/components/MediaCard';
import { CardGridSkeleton } from '@/components/Skeletons';
import { EmptyState, ErrorState } from '@/components/States';
import { Chip } from '@/components/Chip';
import { InfiniteSentinel } from '@/components/InfiniteSentinel';
import { SearchIcon, XIcon, FilmIcon, PlayIcon } from '@/components/Icons';
import { flattenAlbumPages, useInfiniteAlbums } from '@/features/search/useInfiniteSongs';
import { LANGUAGES, languageLabel } from '@/constants/languages';
import { useSettingsStore } from '@/store/settingsStore';
import { bestImage } from '@/utils/images';
import { playAlbum } from '@/features/player/playEntity';
import { PageHeader } from '@/components/PageHeader';
import { IconButton } from '@/components/IconButton';
import '@/styles/pages/browse.css';

export default function MoviesPage() {
  usePageTitle('Movies');
  const pinned = useSettingsStore((s) => s.pinnedLanguages);
  const [lang, setLang] = useState<string>(pinned[0] ?? 'hindi');
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search.trim(), 350);
  const searching = debounced.length >= 2;
  const query = searching ? debounced : `${languageLabel(lang)} movie songs`;

  const q = useInfiniteAlbums(query);
  const [sort, setSort] = useState<'fresh' | 'az'>('fresh');
  const albums = flattenAlbumPages(q.data?.pages);
  const shown =
    sort === 'az'
      ? [...albums].sort((a, b) =>
          (filmTitleFromAlbumName(a.title) ?? a.title).localeCompare(filmTitleFromAlbumName(b.title) ?? b.title),
        )
      : albums;

  return (
    <div className="vx-browse vx-browse-page max-w-screen-2xl mx-auto">
      <PageHeader title="Movies" />

      <div className="vx-field mb-4 max-w-[720px]">
        <SearchIcon />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search movies…"
          aria-label="Search movies"
        />
        {search && (
          <div className="vx-field-actions">
            <IconButton label="Clear" size="sm" onClick={() => setSearch('')}>
              <XIcon className="w-4 h-4" />
            </IconButton>
          </div>
        )}
      </div>

      <div className="vx-chip-rail !mb-6">
        <div className="flex items-center gap-2 shrink-0" role="group" aria-label="Sort movies">
          {(
            [
              ['fresh', 'Fresh'],
              ['az', 'A–Z'],
            ] as const
          ).map(([id, label]) => (
            <Chip key={id} active={sort === id} onClick={() => setSort(id)}>
              {label}
            </Chip>
          ))}
        </div>
        {!searching && (
          <>
            <span aria-hidden className="search-filters-sep self-center" />
            {LANGUAGES.map((l) => (
              <Chip key={l.id} active={lang === l.id} onClick={() => setLang(l.id)}>
                {l.label}
              </Chip>
            ))}
          </>
        )}
      </div>

      {q.isLoading && <CardGridSkeleton />}
      {q.isError && <ErrorState retry={() => void q.refetch()} />}
      {!q.isLoading && !q.isError && albums.length === 0 && (
        <EmptyState
          icon={<FilmIcon className="w-8 h-8" />}
          title="Nothing here yet"
          message={
            searching
              ? `No movies matched “${debounced}”.`
              : `Couldn’t load ${languageLabel(lang)} movies right now — try another language.`
          }
        />
      )}
      {albums.length > 0 && (
        <>
          {/* D9 — featured film: the top result as a wide artwork-led card. */}
          {!searching && shown[0] && (
            <Link to={albumPath(shown[0])} className="vx-feature group">
              <img src={bestImage(shown[0].images, 500)} alt="" className="vx-feature-bg" aria-hidden />
              <div className="vx-feature-body">
                <img src={bestImage(shown[0].images, 250)} alt="" className="vx-feature-art" />
                <div className="min-w-0 flex-1">
                  <p className="vx-feature-kind">Featured film</p>
                  <h2 className="vx-feature-title">{filmTitleFromAlbumName(shown[0].title) ?? shown[0].title}</h2>
                  <p className="vx-feature-meta">{shown[0].subtitle || 'Full soundtrack'}</p>
                </div>
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    void playAlbum(shown[0].id, shown[0].title);
                  }}
                  className="vx-play-fab shrink-0"
                  aria-label="Play soundtrack"
                >
                  <PlayIcon />
                </button>
              </div>
            </Link>
          )}
          <div className="vx-card-grid">
            {shown.map((a) => (
              <MediaCard
                key={a.id}
                to={albumPath(a)}
                image={bestImage(a.images)} images={a.images}
                title={filmTitleFromAlbumName(a.title) ?? a.title}
                subtitle={filmTitleFromAlbumName(a.title) ? a.title : a.subtitle}
                fluid
                onPlay={() => void playAlbum(a.id, a.title)}
              />
            ))}
          </div>
          <InfiniteSentinel
            onVisible={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
            disabled={!q.hasNextPage}
            loading={q.isFetchingNextPage}
          />
        </>
      )}
    </div>
  );
}
