import { useState } from 'react';
import { usePageTitle } from '@/hooks/usePageTitle';
import { MOODS, moodSeed } from '@/constants/seeds';
import { flattenSongPages, useInfiniteSongs } from '@/features/search/useInfiniteSongs';
import { useSettingsStore } from '@/store/settingsStore';
import { SongRow } from '@/components/SongRow';
import { ListSkeleton } from '@/components/Skeletons';
import { ErrorState } from '@/components/States';
import { InfiniteSentinel } from '@/components/InfiniteSentinel';
import { cn } from '@/utils/cn';
import { PageHeader } from '@/components/PageHeader';
import { SectionHeader } from '@/components/SectionHeader';
import { moodTone } from '@/features/discover/tones';
import '@/styles/pages/browse.css';
import { usePlayerStore } from '@/store/playerStore';
import { PlayIcon } from '@/components/Icons';

export default function MoodsPage() {
  usePageTitle('Moods');
  const [mood, setMood] = useState<string | null>(null);
  const lang = useSettingsStore((s) => s.pinnedLanguages[0] ?? null);
  const query = useInfiniteSongs(mood ? moodSeed(mood, lang) : '', !!mood);
  const songs = flattenSongPages(query.data?.pages);
  const playQueue = usePlayerStore((s) => s.playQueue);

  return (
    <div className="vx-browse vx-browse-page max-w-screen-2xl mx-auto">
      <PageHeader title="Moods" />
      <div className="vx-browse-tiles">
        {MOODS.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setMood(m.id)}
            aria-pressed={mood === m.id}
            className={cn('vx-browse-tile', moodTone(m.id))}
          >
            <span className="vx-browse-tile-title">{m.label}</span>
            <span className="vx-browse-tile-art is-glyph" aria-hidden>{m.emoji}</span>
          </button>
        ))}
      </div>
      {mood && (
        <section className="vx-section">
          <SectionHeader
            title={`${MOODS.find((m) => m.id === mood)?.label} picks`}
            action={songs.length > 0 && (
              <button type="button" onClick={() => playQueue(songs, 0)} className="vx-pill-btn">
                <PlayIcon /> Play all
              </button>
            )}
          />
          {query.isLoading && <ListSkeleton />}
          {query.isError && <ErrorState retry={() => query.refetch()} />}
          <div className="vx-track-list">
            {songs.map((song, i) => <SongRow key={song.id} song={song} songs={songs} index={i} />)}
          </div>
          {!query.isLoading && !query.isError && (
            <InfiniteSentinel
              onVisible={() => query.hasNextPage && !query.isFetchingNextPage && query.fetchNextPage()}
              disabled={!query.hasNextPage}
              loading={query.isFetchingNextPage}
            />
          )}
        </section>
      )}
    </div>
  );
}
