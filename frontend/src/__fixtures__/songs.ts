import type { HistoryEntry, Song } from '@/types';
import type { RecommendationContext } from '@/services/recommendation/types';
import { createEmptyProfile, type TasteProfile } from '@/services/personalization/profile';

/**
 * v7.0.0 — deterministic fixtures shared by the recommendation, player and
 * Home tests. No randomness, no clocks: every test that needs "now" passes
 * its own timestamp.
 */
export function makeSong(id: string, over: Partial<Song> & { artist?: string } = {}): Song {
  const { artist = 'Artist', ...rest } = over;
  return {
    kind: 'song',
    id,
    title: `Song ${id}`,
    subtitle: artist,
    artists: [{ id: `artist-${artist.toLowerCase().replace(/\s+/g, '-')}`, name: artist }],
    album: null,
    images: [],
    audio: [],
    duration: 210,
    language: 'telugu',
    year: '2022',
    explicit: false,
    hasLyrics: false,
    playCount: 1_000_000,
    ...rest,
  };
}

export function makePlay(song: Song, ts: number, over: Partial<HistoryEntry> = {}): HistoryEntry {
  return { song, ts, completed: true, ...over };
}

/** A warm profile: enough signal that personal terms carry full weight. */
export function warmProfile(now = 0): TasteProfile {
  const p = createEmptyProfile(now);
  p.totals = { plays: 60, completes: 40, skips: 5, favorites: 4, queueAdds: 2 };
  p.languages.telugu = { score: 30, plays: 50, completes: 35, skips: 3, lastTs: now };
  return p;
}

export function makeContext(over: Partial<RecommendationContext> = {}): RecommendationContext {
  return {
    profile: createEmptyProfile(0),
    hour: 12,
    dayOfWeek: 3,
    region: null,
    pinnedLanguages: [],
    mutedLanguages: [],
    intensity: 0.7,
    favorites: [],
    history: [],
    salt: 1,
    ...over,
  };
}
