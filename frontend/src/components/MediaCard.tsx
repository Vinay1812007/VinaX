import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/utils/cn';
import { artSrcSet, bestImage, derivedVariants, FALLBACK_ART } from '@/utils/images';
import { rememberCtxSong } from '@/utils/ctxSongs';
import type { ImageVariant, Song } from '@/types';
import { HeartIcon, PlayIcon } from './Icons';
import { useLibraryStore } from '@/store/libraryStore';
import { useReasonStore } from '@/store/reasonStore';

// Package A8 — dev-mode recommendation debugging: open the app with
// ?debug=recs and every song card grows a tiny line of its top scoring
// reasons. Read once at load; costs nothing when the flag is absent.
const RECS_DEBUG =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debug') === 'recs';

// 4.18.0 LCP-discovery fix: on a cold load the first tiles painted sit above
// the fold and one of them is usually the LCP element — and they were ALL
// loading="lazy", which tells the browser to deprioritize the exact image
// Lighthouse is timing. The first few cards of a session get eager +
// fetchpriority=high from this small module budget; every card after them
// (and every later SPA route, budget already spent) stays lazy as before.
let eagerBudget = 6;

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
  // A8 — unconditional hook call (rules of hooks); selects nothing unless debugging.
  const debugReason = useReasonStore((s) => (RECS_DEBUG && song ? s.reasons[song.id] : undefined));
  // Song cards feed the right-click context menu (idempotent map write).
  if (song) rememberCtxSong(song);
  // Claim an eager slot exactly once per card instance (ref survives
  // re-renders, so a favoriting re-render can't re-drain the budget).
  const eagerRef = useRef<boolean | null>(null);
  if (eagerRef.current === null) eagerRef.current = eagerBudget > 0 && (eagerBudget--, true);
  const eager = eagerRef.current;
  const dv = images ? derivedVariants(images) : undefined;
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
          /* 4.19.5 image-quality pass: the 4.18.0 flat 150 cap kept PSI happy
             but read SOFT on 2x+ phones (owner report). The CDN also serves
             250/350 variants (derivedVariants rewrites them from the 500 URL,
             verified live) — so tiles now negotiate 50/150/250/350: 1x
             desktops take 150, retina phones take 350 (sharp at ≤200 CSS px),
             and nothing fetches the 46 KB 500 except detail-page heroes.
             Derived URLs are constructed, so onError first retries the
             catalog-published original before giving up to placeholder art. */
          src={(dv ? bestImage(dv, 250) : image) || FALLBACK_ART}
          onError={(e) => {
            const t = e.target as HTMLImageElement;
            t.srcset = ''; // srcset outranks src — must clear it for the fallback to show
            const original = images ? bestImage(images, 300) : '';
            if (original && t.src !== original && !t.dataset.vxRetried) {
              t.dataset.vxRetried = '1';
              t.src = original; // derived size missing on CDN — use the real 500
              return;
            }
            t.src = FALLBACK_ART;
          }}
          alt=""
          loading={eager ? 'eager' : 'lazy'}
          fetchPriority={eager ? 'high' : undefined}
          decoding="async"
          width={160}
          height={160}
          srcSet={dv ? artSrcSet(dv, 350) : undefined}
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
              'absolute top-2 right-2 w-9 h-9 rounded-full flex items-center justify-center backdrop-blur-md transition-[color,background-color,border-color,opacity,transform] active:scale-90',
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
      {debugReason && (
        <p className="mt-1 text-[10px] leading-tight text-tide-400/90 line-clamp-2" title={debugReason}>
          {debugReason}
        </p>
      )}
    </Link>
  );
}
