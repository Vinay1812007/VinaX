import { useQuery } from '@tanstack/react-query';
import { diversify, musicalOnly } from '@/services/recommendation/quality';
import type { Song } from '@/types';
import { searchAll, searchSongs, searchAlbums, searchArtists, searchPlaylists } from '@/services/api';
import { languageWeight } from '@/services/personalization/profile';
import { loadProfile } from '@/services/personalization/storage';
import { useSettingsStore } from '@/store/settingsStore';

/**
 * Language- and taste-aware re-ranking of song results. Keeps upstream order
 * as the base signal and nudges by local language affinity — transliteration
 * and mixed-language queries benefit because the user's languages win ties.
 */
export function rankSongs(songs: Song[]): Song[] {
  songs = musicalOnly(songs); // dialogues/BGM/jukebox never rank into music surfaces
  const profile = loadProfile();
  const { pinnedLanguages, mutedLanguages } = useSettingsStore.getState();
  return diversify(songs
    .filter((song) => !(song.language && mutedLanguages.includes(song.language)))
    .map((song, i) => {
      let score = (songs.length - i) / songs.length; // upstream position
      score += languageWeight(profile, song.language) * 0.4;
      if (song.language && pinnedLanguages.includes(song.language)) score += 0.25;
      return { song, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((x) => x.song));
}

export function normalizeQuery(q: string): string {
  return q.trim().replace(/\s+/g, ' ').slice(0, 120);
}

export function useSearchAll(query: string) {
  const q = normalizeQuery(query);
  return useQuery({
    queryKey: ['search-all', q],
    queryFn: () => searchAll(q),
    enabled: q.length > 1,
  });
}

export function useSearchSongs(query: string, enabled = true) {
  const q = normalizeQuery(query);
  return useQuery({
    queryKey: ['search-songs', q],
    queryFn: async () => rankSongs(await searchSongs(q, 30)),
    enabled: enabled && q.length > 1,
  });
}

export function useSearchAlbums(query: string, enabled = true) {
  const q = normalizeQuery(query);
  return useQuery({
    queryKey: ['search-albums', q],
    queryFn: () => searchAlbums(q),
    enabled: enabled && q.length > 1,
  });
}

export function useSearchArtists(query: string, enabled = true) {
  const q = normalizeQuery(query);
  return useQuery({
    queryKey: ['search-artists', q],
    queryFn: () => searchArtists(q),
    enabled: enabled && q.length > 1,
  });
}

export function useSearchPlaylists(query: string, enabled = true) {
  const q = normalizeQuery(query);
  return useQuery({
    queryKey: ['search-playlists', q],
    queryFn: () => searchPlaylists(q),
    enabled: enabled && q.length > 1,
  });
}
