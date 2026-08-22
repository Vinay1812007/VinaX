import { useQuery } from '@tanstack/react-query';
import type { Song } from '@/types';
import { searchSongs } from '@/services/api';
import { rankSongs } from '@/features/search/useSearch';
import { useSettingsStore } from '@/store/settingsStore';
import { dailyBucket, hashString } from './dailyRotation';

const STALE = 4 * 60 * 60_000;

/** Ordered list of mood shelves the home page can rotate through. */
export const MOOD_SHELVES: Array<{ id: string; title: string; query: string }> = [
  { id: 'workout', title: 'Workout Mix', query: 'workout gym motivation songs' },
  { id: 'chill', title: 'Chill Vibes', query: 'chill lofi relax songs' },
  { id: 'focus', title: 'Focus Music', query: 'instrumental focus study music' },
  { id: 'sleep', title: 'Sleep Sounds', query: 'sleep soothing ambient music' },
  { id: 'party', title: 'Party Hits', query: 'party dance hits' },
  { id: 'roadtrip', title: 'Road Trip', query: 'road trip driving songs' },
  { id: 'morning', title: 'Morning Boost', query: 'morning fresh feel good songs' },
  { id: 'evening', title: 'Evening Relaxation', query: 'evening relax melodies' },
  { id: 'rainy', title: 'Rainy Day', query: 'rainy day monsoon soothing songs' },
  { id: 'feelgood', title: 'Feel Good', query: 'feel good happy songs' },
];

/**
 * Shared factory — one mood + one language → a `useQuery` returning up to
 * 12 songs. Language-prefixed so a Tamil user gets Tamil workout mixes, not
 * generic English ones. Keyed on `dailyBucket()` so results rotate daily.
 */
export function useMoodShelf(mood: string, lang: string, limit = 12) {
  const bucket = dailyBucket();
  const q = `${lang} ${mood}`.trim();
  return useQuery<Song[]>({
    queryKey: ['mood-shelf', mood, lang, bucket],
    enabled: mood.length > 0,
    staleTime: STALE,
    queryFn: async () => {
      const songs = await searchSongs(q, Math.max(limit, 12));
      return rankSongs(songs).slice(0, limit);
    },
  });
}

// Thin wrappers per the ask — each is a one-liner around the factory. They
// subscribe to the pinned-language via the primary hook so a language change
// invalidates the mood shelf naturally.
function usePrimaryLang(): string {
  return useSettingsStore((s) => s.pinnedLanguages[0] ?? 'hindi');
}
export const useWorkoutMix = () => useMoodShelf('workout gym motivation', usePrimaryLang());
export const useChillVibes = () => useMoodShelf('chill lofi relax', usePrimaryLang());
export const useFocusMusic = () => useMoodShelf('instrumental focus study', usePrimaryLang());
export const useSleepSounds = () => useMoodShelf('sleep soothing ambient', usePrimaryLang());
export const usePartyHits = () => useMoodShelf('party dance hits', usePrimaryLang());
export const useRoadTrip = () => useMoodShelf('road trip driving', usePrimaryLang());
export const useMorningBoost = () => useMoodShelf('morning fresh feel good', usePrimaryLang());
export const useEveningRelaxation = () => useMoodShelf('evening relax melodies', usePrimaryLang());
export const useRainyDay = () => useMoodShelf('rainy day monsoon soothing', usePrimaryLang());
export const useFeelGood = () => useMoodShelf('feel good happy songs', usePrimaryLang());

/**
 * Pick 6 different mood shelves for today, stable within a UTC day. The
 * rotation is deterministic so a full-day cache stays coherent and users
 * see the same 6 moods on repeat visits within the day.
 */
export function moodRotationOfTheDay(count = 6): Array<{ id: string; title: string; query: string }> {
  const bucket = dailyBucket();
  const shift = hashString(String(bucket)) % MOOD_SHELVES.length;
  const out: Array<{ id: string; title: string; query: string }> = [];
  for (let i = 0; i < count; i += 1) {
    out.push(MOOD_SHELVES[(shift + i) % MOOD_SHELVES.length]);
  }
  return out;
}
