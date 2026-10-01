import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BookmarkIcon, ClockIcon, DownloadIcon, HeartIcon, SparkleIcon, WaveIcon } from '@/components/Icons';
import { cn } from '@/utils/cn';

export interface ShortcutCounts {
  liked: number;
  later: number;
  /** Songs saved for offline play; null where downloads are not available (the website). */
  downloads: number | null;
  plays: number;
}

const songs = (n: number) => (n ? `${n} song${n === 1 ? '' : 's'}` : 'Nothing yet');

interface Tile {
  to: string;
  label: string;
  meta: string;
  icon: ReactNode;
  tone: 'liked' | 'later' | 'plain';
  /** A description rather than a count — phones leave it out. */
  note?: boolean;
}

/**
 * 9.0 — the Library's way into everything that is not a playlist: liked
 * songs, Listen later, downloads and history, each with its live count, then
 * the listening report and the taste profile. The tutorial points at this
 * nav by its label, so the label stays.
 */
export function LibraryShortcuts({ counts }: { counts: ShortcutCounts }) {
  const tiles: Tile[] = [
    { to: '/favorites', label: 'Liked songs', meta: songs(counts.liked), icon: <HeartIcon filled />, tone: 'liked' },
    { to: '/later', label: 'Listen later', meta: songs(counts.later), icon: <BookmarkIcon />, tone: 'later' },
    {
      to: '/offline',
      label: 'Downloads',
      meta: counts.downloads === null ? 'Android app' : songs(counts.downloads),
      icon: <DownloadIcon />,
      tone: 'plain',
    },
    { to: '/history', label: 'History', meta: counts.plays ? `${counts.plays} play${counts.plays === 1 ? '' : 's'}` : 'Nothing yet', icon: <ClockIcon />, tone: 'plain' },
    { to: '/stats', label: 'Your VinaX', meta: 'Your listening in numbers', icon: <WaveIcon />, tone: 'plain', note: true },
    { to: '/taste-profile', label: 'Taste profile', meta: 'What shapes your mixes', icon: <SparkleIcon />, tone: 'plain', note: true },
  ];
  return (
    <nav className="vx-lp-quick" aria-label="Your collection shortcuts">
      {tiles.map((t) => (
        <Link key={t.to} to={t.to} className="vx-lp-tile">
          <span className={cn('vx-lp-tile-glyph', `is-${t.tone}`)} aria-hidden>{t.icon}</span>
          <span className="vx-lp-tile-text">
            <span className="vx-lp-tile-title">{t.label}</span>
            <span className={cn('vx-lp-tile-meta', t.note && 'is-static')}>{t.meta}</span>
          </span>
        </Link>
      ))}
    </nav>
  );
}
