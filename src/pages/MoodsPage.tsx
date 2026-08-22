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
    <div className="max-w-4xl mx-auto">
      <h1 className="text-display tracking-tight mb-6">Moods</h1>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        {MOODS.map((m) => (
          <button
            key={m.id}
            onClick={() => setMood(m.id)}
            className={cn(
              'rounded-2xl border p-5 text-left transition-[color,background-color,border-color,opacity,transform] hover:-translate-y-0.5',
              mood === m.id ? 'border-ember-500 bg-ink-800' : 'border-ink-700 bg-ink-850 hover:border-ink-500',
            )}
          >
            <span className="text-2xl">{m.emoji}</span>
            <p className="font-bold mt-2">{m.label}</p>
          </button>
        ))}
      </div>
      {mood && (
        <>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-title">{MOODS.find((m) => m.id === mood)?.label} picks</h2>
            {songs.length > 0 && (
              <button onClick={() => playQueue(songs, 0)} className="flex items-center gap-1.5 px-4 py-2 rounded-full btn-primary text-xs font-bold">
                <PlayIcon className="w-3.5 h-3.5" /> Play all
              </button>
            )}
          </div>
          {query.isLoading && <ListSkeleton />}
          {query.isError && <ErrorState retry={() => query.refetch()} />}
          {songs.map((song, i) => <SongRow key={song.id} song={song} songs={songs} index={i} />)}
          {!query.isLoading && !query.isError && (
            <InfiniteSentinel
              onVisible={() => query.hasNextPage && !query.isFetchingNextPage && query.fetchNextPage()}
              disabled={!query.hasNextPage}
              loading={query.isFetchingNextPage}
            />
          )}
        </>
      )}
    </div>
  );
}
