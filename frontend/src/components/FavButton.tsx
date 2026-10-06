import type { Song } from '@/types';
import { useLibraryStore } from '@/store/libraryStore';
import { toast, toastNavigate } from '@/store/toastStore';
import { cn } from '@/utils/cn';
import { isFavoriteIn } from '@/utils/favIndex';
import { bestImage } from '@/utils/images';
import { HeartIcon } from './Icons';

/**
 * 10.1.0 — like or unlike a song and confirm it with a snackbar carrying the
 * cover: "Added to Liked songs · View", or "Removed from Liked songs · Undo"
 * (the toggle is its own undo).
 */
export function toggleLike(song: Song): void {
  const lib = useLibraryStore.getState();
  const wasLiked = lib.isFavorite(song.id);
  lib.toggleFavorite(song);
  const image = bestImage(song.images, 50);
  if (wasLiked) {
    toast('Removed from Liked songs', { key: 'like', image, action: { label: 'Undo', onClick: () => useLibraryStore.getState().toggleFavorite(song) } });
  } else {
    toast('Added to Liked songs', { key: 'like', image, action: { label: 'View', onClick: () => toastNavigate('/favorites') } });
  }
}

export function FavButton({ song, className }: { song: Song; className?: string }) {
  const isFav = useLibraryStore((s) => isFavoriteIn(s.favorites, song.id));
  return (
    <button
      type="button"
      aria-label={isFav ? 'Remove from favorites' : 'Add to favorites'}
      aria-pressed={isFav}
      onClick={(e) => {
        e.stopPropagation();
        toggleLike(song);
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
