import { Link } from 'react-router-dom';
import { cn } from '@/utils/cn';
import { artSrcSet, FALLBACK_ART } from '@/utils/images';
import { rememberCtxSong } from '@/utils/ctxSongs';
import type { ImageVariant, Song } from '@/types';
import { HeartIcon, PlayIcon } from './Icons';
import { useLibraryStore } from '@/store/libraryStore';

interface Props {
  to: string;
  image: string;
  /** Raw size variants — enables a responsive srcset so small cells fetch small files. */
  images?: ImageVariant[];
  title: string;
  subtitle?: string;
  round?: boolean;
  /** Fill the parent cell (grid layouts) instead of fixed shelf width. */
  fluid?: boolean;
  onPlay?: () => void;
  /** When provided, the card gains a hover ♥ that toggles Favorites. */
  song?: Song;
}

export function MediaCard({ to, image, images, title, subtitle, round, fluid, onPlay, song }: Props) {
  const isFav = useLibraryStore((s) => (song ? s.favorites.some((f) => f.id === song.id) : false));
  const toggleFavorite = useLibraryStore((s) => s.toggleFavorite);
  // Song cards feed the right-click context menu (idempotent map write).
  if (song) rememberCtxSong(song);
  return (
    <Link
      to={to}
      data-deter-context
      data-song-id={song?.id}
      className={cn(
        'group rounded-xl p-3 transition-colors duration-200 hover:bg-ink-850/80 active:scale-[0.98] animate-fade-up',
        fluid ? 'w-full' : 'w-40 sm:w-44 shrink-0',
      )}
    >
      <div className={cn('relative overflow-hidden shadow-card transition-shadow duration-300 group-hover:shadow-float', round ? 'rounded-full' : 'rounded-lg')}>
        <img
          src={image || FALLBACK_ART}
          onError={(e) => {
            const t = e.target as HTMLImageElement;
            t.srcset = ''; // srcset outranks src — must clear it for the fallback to show
            t.src = FALLBACK_ART;
          }}
          alt=""
          loading="lazy"
          decoding="async"
          srcSet={images ? artSrcSet(images) : undefined}
          sizes={
            images
              ? fluid
                ? '(min-width: 1280px) 200px, (min-width: 640px) 22vw, 44vw'
                : '(min-width: 640px) 160px, 144px'
              : undefined
          }
          className={cn('w-full aspect-square object-cover transition-transform duration-300 ease-vinax group-hover:scale-[1.03]', round ? 'rounded-full' : 'rounded-lg')}
        />
        {song && (
          <button
            aria-label={isFav ? `Remove ${title} from favorites` : `Add ${title} to favorites`}
            aria-pressed={isFav}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              toggleFavorite(song);
            }}
            className={cn(
              'absolute top-2 right-2 w-9 h-9 rounded-full flex items-center justify-center backdrop-blur-md transition-all active:scale-90',
              isFav ? 'bg-ember-500/90 text-white' : 'bg-black/40 text-white/90 hover:bg-black/60 hover-reveal',
            )}
          >
            <HeartIcon className="w-4 h-4" />
          </button>
        )}
        {onPlay && (
          <>
            {/* Legibility scrim under the play chip — always on for touch, fades in on hover. */}
            <div aria-hidden className="card-scrim" />
            <button
              aria-label={`Play ${title}`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onPlay();
              }}
              className="card-play"
            >
              <PlayIcon />
            </button>
          </>
        )}
      </div>
      {/* Reserved heights keep every shelf row perfectly even. */}
      <p className={cn('mt-3 text-[15px] font-semibold leading-tight line-clamp-2 min-h-[2.5em]', round && 'text-center')}>{title}</p>
      {subtitle && (
        <p className={cn('mt-1 text-[13px] font-medium text-ink-400 leading-snug truncate', round && 'text-center')}>
          {subtitle}
        </p>
      )}
    </Link>
  );
}
