import type { Song } from '@/types';
import { usePlayerStore } from '@/store/playerStore';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import { songLine } from '@/utils/songLine';
import { cn } from '@/utils/cn';

/**
 * 9.0 — the short "Up next" list shared by the full-screen player's panel and
 * the wide-screen Now Playing panel: artwork, Song, Movie/Album – Artist.
 * Tap to jump (the Queue page's rules: store/queueRules.ts `jumpTo`).
 *
 * `songs` is a slice of the queue starting at absolute index `start`.
 */
export function UpNextRows({ songs, start, variant }: { songs: Song[]; start: number; variant: 'stage' | 'rail' }) {
  return (
    <ol className={cn('vx-upnext', variant === 'rail' && 'is-rail')}>
      {songs.map((s, i) => {
        const line = songLine(s);
        return (
          <li key={`${s.id}-${start + i}`} style={{ ['--i' as string]: Math.min(i, 8) }}>
            <button type="button" onClick={() => usePlayerStore.getState().playAt(start + i)} className="vx-upnext-row">
              <img
                src={bestImage(s.images, 150)}
                onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)}
                alt=""
                loading="lazy"
                decoding="async"
              />
              <span className="vx-upnext-text">
                {/* Song – Movie/Album – Artist */}
                <span className="vx-upnext-title">{line.title}</span>
                <span className="vx-upnext-meta">{[line.album, line.artist].filter(Boolean).join(' – ')}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
