import { Link } from 'react-router-dom';
import { usePageTitle } from '@/hooks/usePageTitle';
import {
  CompassIcon,
  PlayIcon,
  FilmIcon,
  GlobeIcon,
  HeartIcon,
  MusicIcon,
  SparkleIcon,
  WaveIcon,
} from '@/components/Icons';

const tiles: Array<{ to: string; label: string; hint: string; icon: typeof CompassIcon }> = [
  { to: '/discover', label: 'Discover', hint: 'Fresh picks & playlists', icon: CompassIcon },
  { to: '/charts', label: 'Charts', hint: 'Top songs by language', icon: WaveIcon },
  { to: '/movies', label: 'Movies', hint: 'Film soundtracks', icon: FilmIcon },
  { to: '/moods', label: 'Moods', hint: 'Music for every vibe', icon: SparkleIcon },
  { to: '/languages', label: 'Languages', hint: 'Pin what you listen to', icon: MusicIcon },
  { to: '/regions', label: 'Regions', hint: 'Tuned to your region', icon: GlobeIcon },
  { to: '/made-for-you', label: 'Made For You', hint: 'Your personal mixes', icon: HeartIcon },
  { to: '/quiz', label: 'Music Quiz', hint: 'Guess the song, beat your streak', icon: PlayIcon },
];

export default function ExplorePage() {
  usePageTitle('Explore');
  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-display tracking-tight mb-1">Explore</h1>
      <p className="text-sm text-ink-400 mb-5">Everything VinaX has to offer, in one place.</p>
      <div className="grid grid-cols-2 gap-3">
        {tiles.map(({ to, label, hint, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="glass-card glass-hover rounded-2xl p-4 flex flex-col gap-3 active:scale-[0.98] transition-transform"
          >
            <span className="w-11 h-11 rounded-xl bg-ember-500/15 text-ember-400 flex items-center justify-center">
              <Icon className="w-6 h-6" />
            </span>
            <span>
              <span className="block font-semibold">{label}</span>
              <span className="block text-xs text-ink-400">{hint}</span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
