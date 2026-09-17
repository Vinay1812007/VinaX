import type { Song } from '@/types';
import { useLibraryStore } from '@/store/libraryStore';
import { cn } from '@/utils/cn';
import { isFavoriteIn } from '@/utils/favIndex';
import { HeartIcon } from './Icons';

export function FavButton({ song, className }: { song: Song; className?: string }) {
  const isFav = useLibraryStore((s) => isFavoriteIn(s.favorites, song.id));
  return (
    <button
      type="button"
      aria-label={isFav ? 'Remove from favorites' : 'Add to favorites'}
      aria-pressed={isFav}
      onClick={(e) => {
        e.stopPropagation();
        useLibraryStore.getState().toggleFavorite(song);
      }}
      className={cn(
        'p-2.5 rounded-full hover:bg-ink-700 transition-colors active:scale-90',
        // 36px visual box; the invisible pad grows the HIT area to 44px+ without moving neighbours.
        'relative after:absolute after:inset-0 after:-m-[4px]',
        isFav ? 'text-ember-500' : 'text-ink-300',
        className,
      )}
    >
      <HeartIcon key={String(isFav)} className={cn('w-4 h-4', isFav && 'heart-pop')} filled={isFav} />
    </button>
  );
}
