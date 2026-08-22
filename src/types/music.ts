export interface ImageVariant {
  quality: string;
  url: string;
}

export interface AudioVariant {
  quality: string;
  url: string;
}

export interface ArtistRef {
  id: string;
  name: string;
  role?: string;
  image?: string | null;
}

export interface AlbumRef {
  id: string;
  name: string;
}

export interface Song {
  kind: 'song';
  id: string;
  title: string;
  subtitle: string;
  artists: ArtistRef[];
  album: AlbumRef | null;
  images: ImageVariant[];
  audio: AudioVariant[];
  duration: number | null;
  language: string | null;
  year: string | null;
  explicit: boolean;
  hasLyrics: boolean;
  playCount: number | null;
}

export interface Album {
  kind: 'album';
  id: string;
  title: string;
  subtitle: string;
  images: ImageVariant[];
  artists: ArtistRef[];
  songs: Song[];
  songCount: number | null;
  year: string | null;
  language: string | null;
}

export interface Playlist {
  kind: 'playlist';
  id: string;
  title: string;
  subtitle: string;
  images: ImageVariant[];
  songs: Song[];
  songCount: number | null;
  language: string | null;
}

export interface Artist {
  kind: 'artist';
  id: string;
  name: string;
  subtitle: string;
  images: ImageVariant[];
  bio: string | null;
  topSongs: Song[];
  albums: Album[];
}

export interface Lyrics {
  lyrics: string;
  copyright: string | null;
}

export interface SearchResults {
  songs: Song[];
  albums: Album[];
  artists: Artist[];
  playlists: Playlist[];
}

export type MediaEntity = Song | Album | Playlist | Artist;

export interface RegionInfo {
  country: string | null;
  regionLabel: string | null;
  source: 'edge' | 'browser' | 'manual' | 'unknown';
}

export interface HistoryEntry {
  song: Song;
  ts: number;
  completed: boolean;
}

/** Formal film projection over soundtrack albums (ADR-001 / catalog audit §3).
 *  Movies are not a first-class upstream entity; this is the typed view. */
export interface Movie {
  kind: 'movie';
  /** Soundtrack album id — movie pages resolve through the album. */
  id: string;
  title: string;
  language: string | null;
  year: string | null;
  albumId: string;
  images: ImageVariant[];
}
