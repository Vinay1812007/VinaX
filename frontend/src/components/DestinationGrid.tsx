import { Link } from 'react-router-dom';
import { NAV_GROUPS } from '@/constants/nav';
import {
  ClockIcon,
  FilmIcon,
  GlobeIcon,
  HeartIcon,
  MegaphoneIcon,
  MusicIcon,
  SparkleIcon,
  VideoIcon,
  WaveIcon,
  WaveformIcon,
} from './Icons';
import '@/styles/pages/browse.css';

/** Discover's category tiles: route, display title, palette tone, corner icon. */
const DISCOVER_TILES: Array<[string, string, number, typeof MusicIcon]> = [
  ['/charts', 'Charts', 1, WaveformIcon],
  ['/languages', 'Languages', 2, MusicIcon],
  ['/moods', 'Moods', 3, WaveIcon],
  ['/regions', 'Regions', 4, GlobeIcon],
  ['/movies', 'Movies', 5, FilmIcon],
  ['/videos', 'Videos', 6, VideoIcon],
  ['/made-for-you', 'Made for you', 7, HeartIcon],
  ['/weekly', 'Your week', 8, ClockIcon],
  ['/ai-playlist', 'AI playlist', 9, SparkleIcon],
  ['/ads', 'Ads', 10, MegaphoneIcon],
];
const LIBRARY_ROUTES = ['/favorites', '/later', '/offline', '/history', '/stats', '/taste-profile'];

/** Secondary routes remain discoverable inside their primary workspace. */
export function DestinationGrid({ area }: { area: 'discover' | 'library' }) {
  const items = NAV_GROUPS.flatMap((g) => g.items);
  if (area === 'library') {
    return (
      <nav className="vx-destinations" aria-label="Your collection shortcuts">
        {LIBRARY_ROUTES.map((to) => {
          const item = items.find((i) => i.to === to);
          if (!item) return null;
          const Icon = item.icon;
          return <Link key={to} to={to}><Icon className="w-5 h-5" /><span>{item.label}</span></Link>;
        })}
      </nav>
    );
  }
  return (
    <nav className="vx-browse-tiles" aria-label="Browse music">
      {DISCOVER_TILES.map(([to, title, tone, Icon]) => (
        <Link key={to} to={to} className={`vx-browse-tile vx-tone-${tone}`}>
          <span className="vx-browse-tile-title">{title}</span>
          <span className="vx-browse-tile-art" aria-hidden><Icon /></span>
        </Link>
      ))}
    </nav>
  );
}
