import {
  ClockIcon,
  CompassIcon,
  DownloadIcon,
  FilmIcon,
  GlobeIcon,
  HeartIcon,
  HomeIcon,
  LibraryIcon,
  MusicIcon,
  QueueIcon,
  SearchIcon,
  SettingsIcon,
  SparkleIcon,
  UsersIcon,
  WaveIcon,
} from '@/components/Icons';

export interface NavItem {
  to: string;
  label: string;
  icon: typeof HomeIcon;
}
export interface NavGroup {
  label: string;
  items: NavItem[];
}

/** One source of truth for the sidebar routes — also feeds the ⌘K palette. */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Listen',
    items: [
      { to: '/', label: 'Home', icon: HomeIcon },
      { to: '/VinaXAI', label: 'VinaX AI', icon: SparkleIcon },
      { to: '/discover', label: 'Discover', icon: CompassIcon },
      { to: '/charts', label: 'Charts', icon: WaveIcon },
      { to: '/made-for-you', label: 'Made For You', icon: SparkleIcon },
      { to: '/weekly', label: 'Your Week', icon: SparkleIcon },
      { to: '/ai-playlist', label: 'AI Playlist', icon: SparkleIcon },
      { to: '/search', label: 'Search', icon: SearchIcon },
    ],
  },
  {
    label: 'Your Music',
    items: [
      { to: '/library', label: 'Library', icon: LibraryIcon },
      { to: '/favorites', label: 'Favorites', icon: HeartIcon },
      { to: '/history', label: 'History', icon: ClockIcon },
      { to: '/queue', label: 'Queue', icon: QueueIcon },
      { to: '/stats', label: 'Your VinaX', icon: SparkleIcon },
      { to: '/offline', label: 'Downloads', icon: DownloadIcon },
      { to: '/together', label: 'Listen Together', icon: UsersIcon },
    ],
  },
  {
    label: 'Explore',
    items: [
      { to: '/movies', label: 'Movies', icon: FilmIcon },
      { to: '/languages', label: 'Languages', icon: MusicIcon },
      { to: '/moods', label: 'Moods', icon: WaveIcon },
      { to: '/regions', label: 'Regions', icon: GlobeIcon },
      { to: '/taste-profile', label: 'Taste Profile', icon: SparkleIcon },
      { to: '/settings', label: 'Settings', icon: SettingsIcon },
    ],
  },
];
