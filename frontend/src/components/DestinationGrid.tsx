import { Link } from 'react-router-dom';
import { NAV_GROUPS } from '@/constants/nav';

/** Secondary routes remain discoverable inside their primary workspace. */
export function DestinationGrid({ area }: { area: 'discover' | 'library' }) {
  const routes = area === 'discover'
    ? ['/charts', '/languages', '/moods', '/regions', '/movies', '/videos', '/made-for-you', '/weekly', '/ai-playlist', '/ads']
    : ['/favorites', '/later', '/offline', '/history', '/stats', '/taste-profile'];
  const items = NAV_GROUPS.flatMap(g => g.items);
  return <nav className="vx-destinations" aria-label={area === 'discover' ? 'Browse music' : 'Your collection shortcuts'}>
    {routes.map(to => {
      const item = items.find(i => i.to === to);
      if (!item) return null;
      const Icon = item.icon;
      return <Link key={to} to={to}><Icon className="w-5 h-5" /><span>{item.label}</span></Link>;
    })}
  </nav>;
}
