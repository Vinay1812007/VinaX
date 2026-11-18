import type { Song } from '@/types';
import { useLibraryStore } from '@/store/libraryStore';
import { toast, toastNavigate } from '@/store/toastStore';
import { cn } from '@/utils/cn';
import { isFavoriteIn } from '@/utils/favIndex';
import { bestImage } from '@/utils/images';
import { requireAccount } from '@/services/auth/gate';
import { useT } from '@/i18n';
/** The like control's glyph: ⊕ to add, a filled green disc with a black ✓ once liked. */
export function LikeGlyph({ on, className }: { on: boolean; className?: string }) {
  return on ? (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <circle cx="12" cy="12" r="10.5" fill="currentColor" />
      <path d="m7.4 12.3 3 3 6.2-6.4" fill="none" stroke="rgb(var(--ink-950))" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="9.6" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  );
}

/**
 * 10.1.0 — like or unlike a song and confirm it with a snackbar carrying the
 * cover: "Added to Liked songs · View", or "Removed from Liked songs · Undo"
 * (the toggle is its own undo).
 */
export function toggleLike(song: Song): void {
  // 13.9 — signed out: the sign-in sheet, and the like lands once they have.
  if (!requireAccount('save', () => toggleLike(song))) return;
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
  const t = useT();
  return (
    <button
      type="button"
      aria-label={t(isFav ? 'Remove from favorites' : 'Add to favorites')}
      aria-pressed={isFav}
      onClick={(e) => {
        e.stopPropagation();
        toggleLike(song);
      }}
      className={cn(
        'vx-like p-2.5 rounded-full transition-[color,transform] hover:scale-[1.04] active:scale-90',
        // 36px visual box; the invisible pad grows the HIT area to 44px+ without moving neighbours.
        'relative after:absolute after:inset-0 after:-m-[4px]',
        isFav ? 'text-ember-500' : 'text-ink-300 hover:text-ink-100',
        className,
      )}
    >
      {/* 1.15 — an outlined plus to add; a green disc with a check once it is in Liked songs. */}
      <LikeGlyph key={String(isFav)} on={isFav} className={cn('w-4 h-4', isFav && 'heart-pop')} />
    </button>
  );
}
