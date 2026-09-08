/**
 * v5.17.0 — collage cover for a collection: a 2×2 mosaic of the first four
 * distinct artworks, a single artwork when there are fewer, or a placeholder
 * glyph (the collection's emoji, if any) when there is no art at all.
 */
import type { SyntheticEvent } from 'react';
import type { Song } from '@/types';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import { LibraryIcon } from '@/components/Icons';
import { cn } from '@/utils/cn';

interface Props {
  songs: Song[];
  /** Placeholder glyph when there is no artwork. */
  emoji?: string;
  /** Size hint for `bestImage` — 150 for tiles, 300 for a page header. */
  minPx?: number;
  className?: string;
}

/** First four distinct artwork URLs (the inline placeholder never counts). */
export function collageArt(songs: Song[], minPx = 150): string[] {
  const urls: string[] = [];
  for (const song of songs) {
    const url = bestImage(song.images, minPx);
    if (url === FALLBACK_ART || urls.includes(url)) continue;
    urls.push(url);
    if (urls.length === 4) break;
  }
  return urls;
}

const swapToFallback = (e: SyntheticEvent<HTMLImageElement>) => {
  (e.target as HTMLImageElement).src = FALLBACK_ART;
};

export function CollageCover({ songs, emoji, minPx = 150, className }: Props) {
  const art = collageArt(songs, minPx);
  const base = cn('relative overflow-hidden rounded-xl bg-ink-800 shrink-0', className);

  if (art.length === 0) {
    return (
      <div className={cn(base, 'flex items-center justify-center text-ink-500')} aria-hidden>
        {emoji ? <span className="text-[55%] leading-none">{emoji}</span> : <LibraryIcon className="w-1/2 h-1/2" />}
      </div>
    );
  }

  if (art.length < 4) {
    return (
      <div className={base} aria-hidden>
        <img src={art[0]} onError={swapToFallback} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
      </div>
    );
  }

  return (
    <div className={cn(base, 'grid grid-cols-2 grid-rows-2')} aria-hidden>
      {art.map((url, i) => (
        <img key={`${i}-${url}`} src={url} onError={swapToFallback} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
      ))}
    </div>
  );
}
