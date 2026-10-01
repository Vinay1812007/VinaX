import type { Song } from '@/types';
import { usePlayerStore } from '@/store/playerStore';
import { useReasonStore } from '@/store/reasonStore';
import { originOf } from '@/features/queue/origin';
import { OriginBadge } from '@/features/queue/OriginBadge';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import { songLine } from '@/utils/songLine';
import { cn } from '@/utils/cn';

/**
 * 9.0 — the short "Up next" list shared by the full-screen player's panel and
 * the wide-screen Now Playing panel: artwork, Song, Movie/Album – Artist, and
 * who put it there ("VinaX pick" / "Added by you", in words). Tap to jump.
 *
 * `songs` is a slice of the queue starting at absolute index `start`. The
 * parent subscribes to the queue, and every ownership change replaces the
 * queue, so the markers re-read here stay current.
 */
export function UpNextRows({ songs, start, variant }: { songs: Song[]; start: number; variant: 'stage' | 'rail' }) {
  const reasons = useReasonStore((s) => s.reasons);
  return (
    <ol className={cn('vx-upnext', variant === 'rail' && 'is-rail')}>
      {songs.map((s, i) => {
        const line = songLine(s);
        const origin = originOf(s.id);
        // The DJ's own one-line reason, only on what it picked.
        const why = origin === 'auto' ? reasons[s.id] : undefined;
        return (
          <li key={`${s.id}-${start + i}`}>
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
                {origin !== 'list' && (
                  <span className="vx-upnext-origin">
                    <OriginBadge origin={origin} />
                    {why && variant === 'stage' && <span className="vx-upnext-why">{why}</span>}
                  </span>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
