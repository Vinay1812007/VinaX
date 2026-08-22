import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { diversify, musicalOnly } from '@/services/recommendation/quality';
import type { Song } from '@/types';
import { searchAll, searchSongs, searchAlbums } from '@/services/api';
import { languageWeight } from '@/services/personalization/profile';
import { loadProfile } from '@/services/personalization/storage';
import { useSettingsStore } from '@/store/settingsStore';
import { stripExplicit } from '@/services/kidMode';

/** Case/diacritic fold for matching. NFD only strips Latin combining marks
 *  (U+0300–036F) — Devanagari/Telugu/Tamil vowel signs live in their own
 *  blocks and are untouched, so Indic queries are never mangled. */
function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/** Text-relevance boost (delta audit P2-28): how well a song matches what
 *  the user actually typed. Zero when no query — shelf/seed surfaces rank by
 *  taste alone. */
function relevance(query: string, song: Song): number {
  if (!query) return 0;
  const q = fold(query);
  const title = fold(song.title);
  if (title === q) return 1.0;
  if (title.startsWith(q)) return 0.6;
  if (title.includes(q)) return 0.4;
  if (fold(song.subtitle ?? '').includes(q)) return 0.25;
  return 0;
}

export interface RankOpts {
  /** The user's literal query — enables the text-relevance boost. */
  query?: string;
  /** Explicit search surfaces: NO junk filter (a real "(Lyrical)" title must
   *  be findable — quality.ts's own contract) and NO diversify (searching a
   *  song title SHOULD surface its versions; the per-page cap was also
   *  starving infinite scroll on album queries — audit P0-6). */
  searchMode?: boolean;
}

/**
 * Language-, taste- and (in search mode) relevance-aware re-ranking. Keeps
 * upstream order as the base signal, nudges by local language affinity —
 * transliteration and mixed-language queries benefit because the user's
 * languages win ties — and lets literal text matches take the top slots.
 */
export function rankSongs(songs: Song[], opts: RankOpts = {}): Song[] {
  const { query = '', searchMode = false } = opts;
  if (!searchMode) songs = musicalOnly(songs); // dialogues/BGM never rank into music shelves
  songs = stripExplicit(songs); // C2 — kid mode hides explicit-flagged songs everywhere this ranks
  const profile = loadProfile();
  const { pinnedLanguages, mutedLanguages } = useSettingsStore.getState();
  const ranked = songs
    .filter((song) => !(song.language && mutedLanguages.includes(song.language)))
    .map((song, i) => {
      let score = (songs.length - i) / songs.length; // upstream position
      score += languageWeight(profile, song.language) * 0.4;
      if (song.language && pinnedLanguages.includes(song.language)) score += 0.25;
      score += relevance(query, song) * 0.8;
      return { song, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((x) => x.song);
  return searchMode ? ranked : diversify(ranked);
}

/** Canonical query form (delta audit P1-11): case- and whitespace-folded so
 *  "Arijit", "arijit" and "ARIJIT " share one cache entry and one network
 *  request. NFC keeps composed Indic text stable. */
export function normalizeQuery(q: string): string {
  return q.normalize('NFC').toLowerCase().trim().replace(/\s+/g, ' ').slice(0, 120);
}

/** Zero-result rescue: a gentler variant of the query — punctuation dropped,
 *  triple+ repeated letters collapsed to one ("arijittt" → "arijit"; legit
 *  doubles are untouched, and triples are held-key typos in practice).
 *  Returns null when it wouldn't differ, so callers only retry when there is
 *  a new angle. */
export function relaxedQuery(q: string): string | null {
  const relaxed = normalizeQuery(
    q
      .replace(/[(){}[\]"'!?.,:;]+/g, ' ')
      .replace(/([a-z])\1{2,}/gi, '$1'),
  );
  return relaxed && relaxed !== normalizeQuery(q) ? relaxed : null;
}

// All search hooks: the query's abort signal is threaded to the network layer
// (typing cancels the previous keystroke's request — P1-13) and the previous
// result stays on screen while the next settles (no skeleton flash — P2-18).

export function useSearchAll(query: string) {
  const q = normalizeQuery(query);
  return useQuery({
    queryKey: ['search-all', q],
    queryFn: ({ signal }) => searchAll(q, { signal }),
    enabled: q.length > 1,
    placeholderData: keepPreviousData,
  });
}

export function useSearchSongs(query: string, enabled = true) {
  const q = normalizeQuery(query);
  return useQuery({
    queryKey: ['search-songs', q],
    queryFn: async ({ signal }) => {
      const raw = await searchSongs(q, 30, { signal });
      if (raw.length > 0) return rankSongs(raw, { query: q, searchMode: true });
      // Typo rescue (P1-11): one relaxed retry before showing "no results".
      const relaxed = relaxedQuery(q);
      if (!relaxed) return [];
      return rankSongs(await searchSongs(relaxed, 30, { signal }), { query: relaxed, searchMode: true });
    },
    enabled: enabled && q.length > 1,
    placeholderData: keepPreviousData,
  });
}

export function useSearchAlbums(query: string, enabled = true) {
  const q = normalizeQuery(query);
  return useQuery({
    queryKey: ['search-albums', q],
    queryFn: ({ signal }) => searchAlbums(q, 20, { signal }),
    enabled: enabled && q.length > 1,
    placeholderData: keepPreviousData,
  });
}

// useSearchArtists / useSearchPlaylists (single-page, 20-cap) were replaced
// by useInfiniteArtists / useInfinitePlaylists in useInfiniteSongs.ts (P2-30).
