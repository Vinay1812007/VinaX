import { useQuery } from '@tanstack/react-query';
import type { Song } from '@/types';
import { searchSongsPage } from '@/services/api';
import { rankSongs } from '@/features/search/useSearch';
import { loadProfile } from '@/services/personalization/storage';
import { topArtists, topLanguages } from '@/services/personalization/profile';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { languageLabel } from '@/constants/languages';

function todaySeed(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Deterministic shuffle so the mix is stable within a day, fresh the next. */
function seededPick<T>(arr: T[], seed: string, n: number): T[] {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    h = (h * 1103515245 + 12345) & 0x7fffffff;
    const j = h % (i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

/**
 * "VinaX Daily" — one personalized mix that refreshes each morning. Built
 * from your top artists and languages (local taste profile), with a daily
 * seed so it's stable through the day. No cloud, no account.
 */
export function useDailyMix() {
  const pinned = useSettingsStore((s) => s.pinnedLanguages);
  const seed = todaySeed();
  return useQuery({
    queryKey: ['vinax-daily', seed, pinned],
    staleTime: 6 * 60 * 60_000,
    queryFn: async (): Promise<Song[]> => {
      const profile = loadProfile();
      const artists = topArtists(profile, 6).map((a) => a.affinity.name);
      const langs = topLanguages(profile, 2).map((l) => l.id);
      const langSeeds = (langs.length ? langs : pinned.length ? pinned : ['hindi']).map(
        (l) => `${languageLabel(l).toLowerCase()} hits`,
      );
      const queries = seededPick([...artists, ...langSeeds], seed, 5);
      const page = 1 + (Math.abs([...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)) % 3);
      const batches = await Promise.allSettled(queries.map((q) => searchSongsPage(q, page, 8)));
      const seen = new Set<string>();
      const pool: Song[] = [];
      for (const b of batches) {
        if (b.status !== 'fulfilled') continue;
        for (const song of b.value) {
          if (!seen.has(song.id)) {
            seen.add(song.id);
            pool.push(song);
          }
        }
      }
      const hidden = new Set(useLibraryStore.getState().hiddenSongIds);
      const ranked = rankSongs(pool).filter((x) => !hidden.has(x.id));
      const onLang = pinned.length ? ranked.filter((x) => x.language != null && pinned.includes(x.language)) : ranked;
      return seededPick(onLang.length >= 8 ? onLang : ranked, seed + 'x', 20);
    },
  });
}
