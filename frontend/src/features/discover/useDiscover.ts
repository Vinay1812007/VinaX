import { useQuery } from '@tanstack/react-query';
import { searchSongs, searchPlaylists } from '@/services/api';
import { moodSeed, trendingSeed } from '@/constants/seeds';
import { LANGUAGES } from '@/constants/languages';
import { rankSongs } from '@/features/search/useSearch';
import { loadProfile } from '@/services/personalization/storage';
import { useSettingsStore } from '@/store/settingsStore';

export function useMoodSongs(moodId: string, language: string | null) {
  return useQuery({
    queryKey: ['mood', moodId, language],
    queryFn: async () => rankSongs(await searchSongs(moodSeed(moodId, language), 25)),
    enabled: moodId !== '',
    staleTime: 15 * 60_000,
  });
}

export function useEditorialPlaylists(seed: string) {
  return useQuery({
    queryKey: ['editorial', seed],
    queryFn: () => searchPlaylists(seed, 12),
    staleTime: 30 * 60_000,
  });
}

/** Package D2 — recent film soundtracks in the language ("Movies you missed"). */
export function useFilmSoundtracks(language: string) {
  const year = new Date().getFullYear();
  return useQuery({
    queryKey: ['film-songs', language, year],
    queryFn: async () =>
      rankSongs(await searchSongs(`${language === 'unknown' ? '' : language} movie hit songs ${year}`.trim(), 25)),
    staleTime: 30 * 60_000,
  });
}

/**
 * Package D2/A4 — the adventurous corner: trending in a language the listener
 * has never played (not in the taste profile, not pinned, never muted).
 * Rotates daily through the unheard languages; null when every language has
 * been tried (rare — there are 13).
 */
export function useAdventurousCorner() {
  const pinned = useSettingsStore((s) => s.pinnedLanguages);
  const muted = useSettingsStore((s) => s.mutedLanguages);
  const heard = Object.keys(loadProfile().languages);
  const unheard = LANGUAGES.map((l) => l.id).filter(
    (id) => !heard.includes(id) && !pinned.includes(id) && !muted.includes(id),
  );
  // Deterministic daily rotation so the corner changes each day, not each render.
  const day = Math.floor(Date.now() / 86_400_000);
  const language = unheard.length ? unheard[day % unheard.length] : null;
  const query = useQuery({
    queryKey: ['adventurous', language, day],
    enabled: language != null,
    queryFn: async () => rankSongs(await searchSongs(trendingSeed(language as string, day), 20)),
    staleTime: 60 * 60_000,
  });
  return { language, ...query };
}
