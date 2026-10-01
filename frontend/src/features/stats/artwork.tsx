import type { HistoryEntry, Song } from '@/types';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import { cn } from '@/utils/cn';

/**
 * 9.0 — artwork for the listening pages (Your VinaX, the recap, the taste
 * profile). Everything here is read from songs already on this device:
 * history and favourites. Nothing is fetched, so a person with no picture
 * gets their initial, never a stand-in photo.
 */

const key = (name: string): string => name.trim().toLowerCase();

/** Lower-cased artist name → that artist's own picture, when a stored song carries one. */
export function artistPictures(songs: Iterable<Song>): Map<string, string> {
  const out = new Map<string, string>();
  for (const song of songs) {
    for (const a of song.artists ?? []) {
      if (a?.name && a.image && !out.has(key(a.name))) out.set(key(a.name), a.image);
    }
  }
  return out;
}

/** Song id → song, newest history first, then favourites. */
export function songIndex(entries: HistoryEntry[], favorites: Song[]): Map<string, Song> {
  const out = new Map<string, Song>();
  for (const e of entries) if (e.song?.id && !out.has(e.song.id)) out.set(e.song.id, e.song);
  for (const s of favorites) if (s?.id && !out.has(s.id)) out.set(s.id, s);
  return out;
}

/** The most played songs in a history window, most played first (ties: most recent first). */
export function mostPlayed(entries: HistoryEntry[], limit = 5): Array<{ song: Song; count: number }> {
  const counts = new Map<string, { song: Song; count: number; first: number }>();
  entries.forEach((e, i) => {
    if (!e.song?.id) return;
    const cur = counts.get(e.song.id) ?? { song: e.song, count: 0, first: i };
    cur.count += 1;
    counts.set(e.song.id, cur);
  });
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.first - b.first)
    .slice(0, limit)
    .map(({ song, count }) => ({ song, count }));
}

/** The first written character of a name, kept whole for scripts with combining marks. */
export function initialOf(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: 'grapheme' }) => { segment(s: string): Iterable<{ segment: string }> } }).Segmenter;
  if (Seg) {
    for (const part of new Seg(undefined, { granularity: 'grapheme' }).segment(trimmed)) return part.segment.toUpperCase();
  }
  return (Array.from(trimmed)[0] ?? '?').toUpperCase();
}

/** A person is a circle: their picture, or their initial on a quiet tile. */
export function ArtistAvatar({ name, image, size = 44 }: { name: string; image?: string | null; size?: number }) {
  return image ? (
    <img src={image} alt="" width={size} height={size} loading="lazy" className="vx-avatar-img" style={{ width: size, height: size }} />
  ) : (
    <span aria-hidden className="vx-avatar-initial" style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}>
      {initialOf(name)}
    </span>
  );
}

/**
 * Up to four covers as one squircle: the songs that shaped the page. With
 * fewer than four it shows the first cover alone. Decorative — the lists
 * below name every song.
 */
export function Collage({ songs, className }: { songs: Song[]; className?: string }) {
  const covers = songs.map((s) => bestImage(s.images, 300)).filter((u) => u && u !== FALLBACK_ART);
  const unique = [...new Set(covers)];
  if (!unique.length) return null;
  const four = unique.length >= 4 ? unique.slice(0, 4) : [unique[0]];
  return (
    <span aria-hidden className={cn('vx-collage', four.length === 4 && 'is-grid', className)}>
      {four.map((src) => (
        <img key={src} src={src} alt="" loading="lazy" />
      ))}
    </span>
  );
}
