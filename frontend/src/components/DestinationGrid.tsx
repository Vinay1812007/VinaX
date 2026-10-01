import { Link } from 'react-router-dom';
import type { Song } from '@/types';
import { NAV_GROUPS } from '@/constants/nav';
import { MOODS } from '@/constants/seeds';
import { BrowseTile, CoverFan, DestTile, GlyphFan, TileGlyph } from '@/features/discover/BrowseTile';
import { SCRIPT_SAMPLES } from '@/features/discover/scripts';
import {
  ClockIcon,
  FilmIcon,
  GlobeIcon,
  HeartIcon,
  SparkleIcon,
  VideoIcon,
  WaveformIcon,
} from './Icons';
import '@/styles/pages/browse.css';

/** The rest of the browse destinations: route, name, one line, tone, icon. */
const DESTINATIONS: Array<{ to: string; title: string; meta: string; tone: number; icon: typeof GlobeIcon; ai?: boolean }> = [
  { to: '/regions', title: 'Regions', meta: 'Local favourites', tone: 4, icon: GlobeIcon },
  { to: '/movies', title: 'Movies', meta: 'Film soundtracks', tone: 5, icon: FilmIcon },
  { to: '/videos', title: 'Videos', meta: 'Music videos', tone: 6, icon: VideoIcon },
  { to: '/made-for-you', title: 'Made for you', meta: 'Mixes from your listening', tone: 7, icon: HeartIcon },
  { to: '/weekly', title: 'Your week', meta: 'Your weekly mix', tone: 8, icon: ClockIcon },
  { to: '/ai-playlist', title: 'AI playlist', meta: 'Describe it, get a playlist', tone: 9, icon: SparkleIcon, ai: true },
];
const LIBRARY_ROUTES = ['/favorites', '/later', '/offline', '/history', '/stats', '/taste-profile'];

/**
 * Secondary routes remain discoverable inside their primary workspace.
 *
 * Discover (and Search's empty box): three lanes first — Charts with the
 * covers of what is popular right now when the page has them, Languages in
 * their own scripts, Moods by their faces — then the other destinations as
 * quieter rows. The library variant is the Library page's shortcut strip.
 */
export function DestinationGrid({ area, chartSongs }: { area: 'discover' | 'library'; chartSongs?: readonly Song[] }) {
  if (area === 'library') {
    const items = NAV_GROUPS.flatMap((g) => g.items);
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
  const covers = chartSongs?.length ? <CoverFan songs={chartSongs} /> : null;
  return (
    <nav className="bx-dests-wrap" aria-label="Browse music">
      <div className="bx-dests">
        <BrowseTile
          to="/charts"
          shape="lane"
          tone="vx-tone-1"
          title="Charts"
          meta="Popular right now"
          visual={covers ?? <TileGlyph><WaveformIcon /></TileGlyph>}
        />
        <BrowseTile
          to="/languages"
          shape="lane"
          tone="vx-tone-2"
          title="Languages"
          meta="In your own script"
          visual={<GlyphFan items={SCRIPT_SAMPLES} />}
        />
        <BrowseTile
          to="/moods"
          shape="lane"
          tone="vx-tone-3"
          title="Moods"
          meta="For how you feel"
          visual={<GlyphFan emoji items={[MOODS[0].emoji, MOODS[2].emoji, MOODS[3].emoji]} />}
        />
        {DESTINATIONS.map(({ to, title, meta, tone, icon: Icon, ai }) => (
          <DestTile key={to} to={to} title={title} meta={meta} tone={`vx-tone-${tone}`} icon={<Icon />} ai={ai} />
        ))}
      </div>
    </nav>
  );
}
