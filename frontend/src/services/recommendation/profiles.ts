import type { HistoryEntry, Song } from '@/types';
import type { TasteProfile } from '@/services/personalization/profile';
import { energyOfSong } from '@/services/personalization/session';
import { inferMood, type Mood } from './mood';

export interface SongProfile {
  id: string;
  language: string | null;
  dialect: string | null;
  subLanguage: string | null;
  genres: string[];
  vibes: string[];
  mood: Mood;
  energy: number;
  tempo: number;
  artistIds: string[];
  artistNames: string[];
}

export interface UserRecommendationProfile {
  languages: Record<string, number>;
  dialects: Record<string, number>;
  subLanguages: Record<string, number>;
  genres: Record<string, number>;
  vibes: Record<string, number>;
  artists: Record<string, number>;
  likedSongIds: Set<string>;
  skippedSongIds: Set<string>;
  recentSongIds: Set<string>;
  avgEnergy: number | null;
  avgTempo: number | null;
  dominantMood: Mood | null;
}

export interface SessionRecommendationProfile {
  recentSongIds: Set<string>;
  avgEnergy: number | null;
  avgTempo: number | null;
  dominantMood: Mood | null;
  dominantLanguage: string | null;
  dominantDialect: string | null;
  size: number;
}

const clean = (value: unknown): string => String(value ?? '').trim().toLowerCase();
const unique = (values: string[]) => [...new Set(values.filter(Boolean))];

const GENRE_HINTS: Array<[RegExp, string]> = [
  [/hip[ -]?hop|rap/i, 'hip-hop'],
  [/rock/i, 'rock'],
  [/classical|orchestra|symphony/i, 'classical'],
  [/devotional|bhajan|qawwali|spiritual/i, 'devotional'],
  [/lo[ -]?fi|chill|ambient|acoustic/i, 'chill'],
  [/party|dance|club|edm|remix/i, 'dance'],
  [/romantic|love|melody|ballad/i, 'romantic'],
];

const VIBE_HINTS: Array<[RegExp, string]> = [
  [/party|dance|club|edm|remix/i, 'upbeat'],
  [/chill|lo[ -]?fi|ambient|sleep/i, 'calm'],
  [/romantic|love|heart/i, 'romantic'],
  [/sad|melancholy|alone|breakup/i, 'melancholy'],
  [/devotional|bhajan|spiritual/i, 'devotional'],
  [/acoustic|unplugged|live/i, 'acoustic'],
];

function textFor(song: Song): string {
  return [song.title, song.subtitle, song.album?.name, song.genre, ...(song.genres ?? []), song.vibe, ...(song.vibes ?? [])].join(' ');
}

function inferred(values: Array<[RegExp, string]>, text: string): string[] {
  return values.filter(([re]) => re.test(text)).map(([, value]) => value);
}

function finite(value: unknown): number | null {
  const n = typeof value === 'number' ? value : NaN;
  return Number.isFinite(n) ? n : null;
}

export function buildSongProfile(song: Song): SongProfile {
  const text = textFor(song);
  const genres = unique([...(song.genres ?? []), song.genre ?? '', ...inferred(GENRE_HINTS, text)].map(clean));
  const vibes = unique([...(song.vibes ?? []), song.vibe ?? '', ...inferred(VIBE_HINTS, text)].map(clean));
  const moodHint = clean(song.mood);
  const mood = ['romantic', 'energetic', 'chill', 'melancholy', 'devotional', 'neutral'].includes(moodHint)
    ? moodHint as Mood
    : inferMood(song);
  const energy = Math.max(0, Math.min(1, finite(song.energy) ?? energyOfSong(song)));
  const tempo = Math.max(40, Math.min(220, finite(song.tempo) ?? ({ energetic: 124, romantic: 92, chill: 72, melancholy: 70, devotional: 82, neutral: 100 }[mood])));
  return {
    id: song.id,
    language: song.language ? clean(song.language) : null,
    dialect: song.dialect ? clean(song.dialect) : null,
    subLanguage: song.subLanguage ? clean(song.subLanguage) : null,
    genres,
    vibes,
    mood,
    energy,
    tempo,
    artistIds: song.artists.map((a) => clean(a.id)).filter(Boolean),
    artistNames: song.artists.map((a) => clean(a.name)).filter(Boolean),
  };
}

function bump(map: Record<string, number>, key: string | null, weight: number): void {
  if (key) map[key] = (map[key] ?? 0) + weight;
}

function addSong(map: UserRecommendationProfile, song: Song, weight: number): void {
  const p = buildSongProfile(song);
  bump(map.languages, p.language, weight);
  bump(map.dialects, p.dialect, weight);
  bump(map.subLanguages, p.subLanguage, weight);
  p.genres.forEach((g) => bump(map.genres, g, weight));
  p.vibes.forEach((v) => bump(map.vibes, v, weight));
  p.artistIds.forEach((a) => bump(map.artists, a, weight));
  p.artistNames.forEach((a) => bump(map.artists, `name:${a}`, weight));
}

export function buildUserRecommendationProfile(profile: TasteProfile, favorites: Song[] = [], history: HistoryEntry[] = []): UserRecommendationProfile {
  const out: UserRecommendationProfile = {
    languages: {}, dialects: {}, subLanguages: {}, genres: {}, vibes: {}, artists: {},
    likedSongIds: new Set([...(profile.likedSongIds ?? []), ...favorites.map((s) => s.id)]),
    skippedSongIds: new Set(profile.skippedSongIds ?? []),
    recentSongIds: new Set(profile.recentSongIds ?? []),
    avgEnergy: null, avgTempo: null, dominantMood: null,
  };
  topMap(profile.languages, out.languages);
  topMap(profile.artists, out.artists);
  favorites.forEach((song) => addSong(out, song, 2));
  history.slice(0, 100).forEach((entry, index) => addSong(out, entry.song, Math.max(0.2, 1 - index / 100)));
  const listened = [...favorites, ...history.map((h) => h.song)];
  if (listened.length) {
    const ps = listened.map(buildSongProfile);
    out.avgEnergy = ps.reduce((sum, p) => sum + p.energy, 0) / ps.length;
    out.avgTempo = ps.reduce((sum, p) => sum + p.tempo, 0) / ps.length;
    out.dominantMood = dominant(ps.map((p) => p.mood));
  }
  return out;
}

function topMap(source: Record<string, { score: number }> | undefined, target: Record<string, number>): void {
  for (const [key, value] of Object.entries(source ?? {})) target[key] = value.score;
}

function dominant<T extends string>(values: T[]): T | null {
  if (!values.length) return null;
  const counts = new Map<T, number>();
  values.forEach((v) => counts.set(v, (counts.get(v) ?? 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

export function buildSessionRecommendationProfile(songs: Song[]): SessionRecommendationProfile {
  const profiles = songs.slice(0, 20).map(buildSongProfile);
  return {
    recentSongIds: new Set(profiles.map((p) => p.id)),
    avgEnergy: profiles.length ? profiles.reduce((s, p) => s + p.energy, 0) / profiles.length : null,
    avgTempo: profiles.length ? profiles.reduce((s, p) => s + p.tempo, 0) / profiles.length : null,
    dominantMood: dominant(profiles.map((p) => p.mood)),
    dominantLanguage: dominant(profiles.map((p) => p.language).filter((v): v is string => !!v)),
    dominantDialect: dominant(profiles.map((p) => p.dialect).filter((v): v is string => !!v)),
    size: profiles.length,
  };
}

export function overlap(left: string[], right: string[]): number {
  if (!left.length || !right.length) return 0;
  const b = new Set(right);
  return left.filter((value) => b.has(value)).length / Math.max(left.length, right.length);
}
