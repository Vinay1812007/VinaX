import { useState } from 'react';
import { albumPath } from '@/utils/slug';
import { filmTitleFromAlbumName } from '@/services/api/movies';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { MediaCard } from '@/components/MediaCard';
import { CardGridSkeleton } from '@/components/Skeletons';
import { EmptyState, ErrorState } from '@/components/States';
import { Chip } from '@/components/Chip';
import { InfiniteSentinel } from '@/components/InfiniteSentinel';
import { SearchIcon, XIcon } from '@/components/Icons';
import { flattenAlbumPages, useInfiniteAlbums } from '@/features/search/useInfiniteSongs';
import { LANGUAGES, languageLabel } from '@/constants/languages';
import { useSettingsStore } from '@/store/settingsStore';
import { bestImage } from '@/utils/images';
import { playAlbum } from '@/features/player/playEntity';

function cnSort(active: boolean): string {
  return active
    ? 'px-3.5 py-1.5 rounded-full text-xs font-bold bg-premium text-white'
    : 'px-3.5 py-1.5 rounded-full text-xs font-semibold bg-ink-800/70 text-ink-300 hover:text-ink-100 transition';
}

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
    <div className="max-w-screen-2xl mx-auto">
      <h1 className="text-display tracking-tight mb-1">Movies</h1>
      <p className="text-sm text-ink-400 mb-4">Film soundtracks and album hits — search or pick a language.</p>
      <div className="flex items-center gap-1.5 mb-4" role="group" aria-label="Sort movies">
        {(
          [
            ['fresh', 'Fresh'],
            ['az', 'A–Z'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setSort(id)}
            aria-pressed={sort === id}
            className={cnSort(sort === id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="relative mb-4">
        <SearchIcon className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-ink-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search movies…"
          className="w-full glass-search rounded-2xl pl-12 pr-12 py-3 text-sm outline-none"
        />
        {search && (
          <button
            aria-label="Clear"
            onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-ink-400 hover:text-ink-100 rounded-full hover:bg-ink-700/70"
          >
            <XIcon className="w-4 h-4" />
          </button>
        )}
      </div>

      {!searching && (
        <div className="flex gap-2 overflow-x-auto no-scrollbar mb-6">
          {LANGUAGES.map((l) => (
            <Chip key={l.id} active={lang === l.id} onClick={() => setLang(l.id)}>
              {l.label}
            </Chip>
          ))}
        </div>
      )}

      {q.isLoading && <CardGridSkeleton />}
      {q.isError && <ErrorState retry={() => void q.refetch()} />}
      {!q.isLoading && !q.isError && albums.length === 0 && (
        <EmptyState
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
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
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
