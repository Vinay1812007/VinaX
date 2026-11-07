import {
  BookmarkIcon,
  ClockIcon,
  CompassIcon,
  DownloadIcon,
  FilmIcon,
  FlowIcon,
  GlobeIcon,
  HeartIcon,
  HomeIcon,
  LibraryIcon,
  ListIcon,
  MicIcon,
  MusicIcon,
  QueueIcon,
  SearchIcon,
  SettingsIcon,
  VideoIcon,
  SparkleIcon,
  UsersIcon,
  WaveIcon,
  WaveformIcon,
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

/** The browse lists, always one click away in the desktop sidebar (Discover's grid on a phone). */
export const BROWSE_NAV: NavItem[] = [
  { to: '/new-releases', label: 'New Releases', icon: SparkleIcon },
  { to: '/charts', label: 'Top Charts', icon: WaveIcon },
  { to: '/top-playlists', label: 'Top Playlists', icon: ListIcon },
  // 1.3 — the catalogue's shows.
  { to: '/podcasts', label: 'Podcasts', icon: MicIcon },
  { to: '/top-artists', label: 'Top Artists', icon: UsersIcon },
  { to: '/radio', label: 'Radio', icon: WaveformIcon },
];

/** One source of truth for the sidebar routes — also feeds the ⌘K palette. */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Listen',
    items: [
      { to: '/', label: 'Home', icon: HomeIcon },
      { to: '/search', label: 'Search', icon: SearchIcon },
      { to: '/discover', label: 'Discover', icon: CompassIcon },
      { to: '/flow', label: 'Flow', icon: FlowIcon },
      { to: '/made-for-you', label: 'Made For You', icon: SparkleIcon },
      { to: '/weekly', label: 'Your Week', icon: SparkleIcon },
    ],
  },
  { label: 'Browse', items: BROWSE_NAV },
  {
    label: 'Your Music',
    items: [
      { to: '/library', label: 'Library', icon: LibraryIcon },
      { to: '/favorites', label: 'Favorites', icon: HeartIcon },
      { to: '/later', label: 'Listen Later', icon: BookmarkIcon },
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
      { to: '/videos', label: 'Videos', icon: VideoIcon },
      { to: '/movies', label: 'Movies', icon: FilmIcon },
      { to: '/languages', label: 'Languages', icon: MusicIcon },
      { to: '/moods', label: 'Moods', icon: WaveIcon },
      { to: '/regions', label: 'Regions', icon: GlobeIcon },
      { to: '/taste-profile', label: 'Taste Profile', icon: SparkleIcon },
      { to: '/settings', label: 'Settings', icon: SettingsIcon },
    ],
  },
];

/** Persistent navigation is intentionally separate from the complete command catalogue. */
export const PRIMARY_NAV: NavItem[] = [
  { to: '/', label: 'Home', icon: HomeIcon },
  { to: '/search', label: 'Search', icon: SearchIcon },
  { to: '/discover', label: 'Discover', icon: CompassIcon },
  // 10.1 — the swipeable song feed (the sidebar list; the phone tab bar keeps its five).
  { to: '/flow', label: 'Flow', icon: FlowIcon },
  // The chat assistant (desktop side nav only; the phone tab bar keeps its four).
  { to: '/vinaxai', label: 'VinaX AI', icon: SparkleIcon },
  { to: '/library', label: 'Library', icon: LibraryIcon },
];
