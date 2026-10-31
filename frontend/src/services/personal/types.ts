/**
 * The personal engine on the wire (backend/worker/functions/_lib/personal/
 * types.ts has the server's copy): what a shelf carries, what a page is, and
 * the song record the server keeps — turned into the app's own `Song` here
 * so every shelf, menu and player works on it unchanged. The audio is
 * resolved when a song starts (the player refetches a song that has none).
 */
import type { Song } from '@/types';

export interface PersonalArtist { id: string | null; name: string }

export interface PersonalSong {
  id: string;
  title: string;
  artist: string;
  artistId: string | null;
  artists: PersonalArtist[];
  album: string | null;
  albumId: string | null;
  language: string | null;
  year: number | null;
  duration: number | null;
  image: string | null;
  facets: { mood?: string; genre?: string; vibe?: string; energy?: number; tempo?: number };
  reason?: string;
}

export interface PersonalShelf {
  key: string;
  title: string;
  reason: string;
  songs: PersonalSong[];
}

export interface PersonalHomePage {
  generatedAt: string;
  expiresAt: string;
  greeting: string | null;
  shelves: PersonalShelf[];
  model: string | null;
  tasteVersion: number;
  cached: boolean;
}

export interface PersonalPlaylist {
  id: string;
  title: string;
  description: string;
  songs: PersonalSong[];
  plan: { title: string; languages: string[]; moods: string[]; artists: string[]; eras: string[]; energy: string; familiarity: string; queries: string[] };
  model: string | null;
  generatedAt: string;
}

export interface PersonalTaste {
  summary: { topArtists: Array<{ id: string; name: string; score: number }>; topLanguages: Array<{ id: string; share: number }>; moods: string[]; decades: string[]; peakHours: number[]; totals: { plays: number; completes: number; skips: number; likes: number }; lines: string[] };
  mode: 'familiar' | 'balanced' | 'discover';
  eventsSeen: number;
  version: number;
  updatedAt: string;
  hasVector: boolean;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** A server song record, checked field by field; null when it is not one. */
export function personalSongOf(raw: unknown): PersonalSong | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const id = str(s.id);
  const title = str(s.title);
  const artist = str(s.artist);
  if (!id || !title || !artist) return null;
  const artists = Array.isArray(s.artists)
    ? s.artists.map((a) => (a && typeof a === 'object' ? { id: str((a as { id?: unknown }).id), name: str((a as { name?: unknown }).name) ?? '' } : null)).filter((a): a is PersonalArtist => !!a && !!a.name).slice(0, 6)
    : [];
  const facets = s.facets && typeof s.facets === 'object' ? (s.facets as PersonalSong['facets']) : {};
  return {
    id, title, artist, artistId: str(s.artistId), artists: artists.length ? artists : [{ id: str(s.artistId), name: artist }],
    album: str(s.album), albumId: str(s.albumId), language: str(s.language), year: num(s.year), duration: num(s.duration),
    image: typeof s.image === 'string' && /^https:\/\//.test(s.image) ? s.image : null, facets, ...(str(s.reason) ? { reason: str(s.reason)! } : {}),
  };
}

export function personalShelfOf(raw: unknown): PersonalShelf | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const key = str(s.key);
  const title = str(s.title);
  if (!key || !title || !Array.isArray(s.songs)) return null;
  const songs = s.songs.map(personalSongOf).filter((x): x is PersonalSong => !!x);
  return songs.length ? { key, title, reason: str(s.reason) ?? '', songs } : null;
}

export function personalHomeOf(raw: unknown): PersonalHomePage | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  if (!Array.isArray(p.shelves)) return null;
  const shelves = p.shelves.map(personalShelfOf).filter((x): x is PersonalShelf => !!x);
  if (!shelves.length) return null;
  return {
    generatedAt: str(p.generatedAt) ?? new Date().toISOString(),
    expiresAt: str(p.expiresAt) ?? new Date(Date.now() + 30 * 60_000).toISOString(),
    greeting: str(p.greeting), shelves, model: str(p.model), tasteVersion: num(p.tasteVersion) ?? 0, cached: p.cached === true,
  };
}

export function personalPlaylistOf(raw: unknown): PersonalPlaylist | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  const id = str(p.id);
  const title = str(p.title);
  if (!id || !title || !Array.isArray(p.songs)) return null;
  const songs = p.songs.map(personalSongOf).filter((x): x is PersonalSong => !!x);
  if (!songs.length) return null;
  const plan = p.plan && typeof p.plan === 'object' ? (p.plan as PersonalPlaylist['plan']) : { title, languages: [], moods: [], artists: [], eras: [], energy: 'any', familiarity: 'mixed', queries: [] };
  return { id, title, description: str(p.description) ?? '', songs, plan, model: str(p.model), generatedAt: str(p.generatedAt) ?? new Date().toISOString() };
}

/** A server record as the app's own Song: shelves, menus and the player need nothing else. */
export function toSong(s: PersonalSong): Song {
  const image = s.image ?? '';
  return {
    kind: 'song',
    id: s.id,
    title: s.title,
    subtitle: s.artists.map((a) => a.name).join(', ') || s.artist,
    artists: s.artists.map((a) => ({ id: a.id ?? '', name: a.name })),
    album: s.album ? { id: s.albumId ?? '', name: s.album } : null,
    images: image ? [{ quality: '500x500', url: image }, { quality: '150x150', url: image.replace('500x500', '150x150') }] : [],
    audio: [],
    duration: s.duration,
    language: s.language,
    year: s.year ? String(s.year) : null,
    explicit: false,
    hasLyrics: false,
    playCount: null,
    mood: s.facets.mood ?? null,
    genre: s.facets.genre ?? null,
    vibe: s.facets.vibe ?? null,
    energy: s.facets.energy ?? null,
    tempo: s.facets.tempo ?? null,
  };
}

/** The facts the reporter sends with an event, from the app's own Song. */
export function factsOf(song: Song): Omit<PersonalSong, 'reason'> {
  const primary = song.artists[0];
  return {
    id: song.id,
    title: song.title,
    artist: primary?.name ?? song.subtitle ?? 'Unknown artist',
    artistId: primary?.id || null,
    artists: song.artists.slice(0, 6).map((a) => ({ id: a.id || null, name: a.name })),
    album: song.album?.name ?? null,
    albumId: song.album?.id || null,
    language: song.language,
    year: song.year ? Number.parseInt(song.year, 10) || null : null,
    duration: song.duration,
    image: song.images.find((i) => i.quality === '500x500')?.url ?? song.images[song.images.length - 1]?.url ?? null,
    facets: {
      ...(song.mood ? { mood: song.mood } : {}),
      ...(song.genre ? { genre: song.genre } : {}),
      ...(song.vibe ? { vibe: song.vibe } : {}),
      ...(typeof song.energy === 'number' ? { energy: song.energy } : {}),
      ...(typeof song.tempo === 'number' ? { tempo: song.tempo } : {}),
    },
  };
}
