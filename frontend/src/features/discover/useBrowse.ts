import { useQuery } from '@tanstack/react-query';
import { API_LANGUAGES, getBrowseCategories, getBrowseCategory, languageParam, type BrowseCategory } from '@/services/api';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import { MOOD_TONES } from './tones';

/**
 * 1.3 — the catalogue's moods & genres (/api/browse). Both calls reject when
 * the API is down (the Worker's backup source has no such routes); callers
 * render what they had before, so neither query retries.
 */

/** The listener's first catalogue language, hindi when none is pinned. */
export function browseLanguage(pinned: readonly string[]): string {
  return languageParam(pinned, 1);
}

/** Languages to offer on a category page: the pinned ones first, then the big ones. */
export function browseLanguageChoices(pinned: readonly string[], max = 6): string[] {
  const supported = API_LANGUAGES as readonly string[];
  const mine = pinned.map((l) => l.toLowerCase()).filter((l) => supported.includes(l));
  return [...new Set([...mine, 'hindi', 'english', 'punjabi', 'tamil', 'telugu', 'bengali'])].slice(0, Math.max(max, mine.length));
}

export function useBrowseCategories(language: string, enabled = true) {
  return useQuery({
    queryKey: ['browse', language],
    queryFn: ({ signal }) => getBrowseCategories(language, { signal }),
    enabled,
    retry: false,
    staleTime: 6 * 60 * 60_000,
  });
}

export function useBrowseCategory(id: string, language: string) {
  return useQuery({
    queryKey: ['browse', id, language],
    queryFn: ({ signal }) => getBrowseCategory(id, language, 10, { signal, priority: 'interactive' }),
    enabled: id !== '',
    retry: false,
    staleTime: 30 * 60_000,
  });
}

export interface BrowseGroup {
  key: string;
  title: string;
  items: BrowseCategory[];
}

const GROUPS: Array<[string, string]> = [
  ['mood', 'Moods & moments'],
  ['genre', 'Genres'],
];

/**
 * Moods first, then genres, then anything else the catalogue labels. The
 * podcast shelf (`music_plus`) has no songs or playlists, so it is left out.
 */
export function groupCategories(list: readonly BrowseCategory[]): BrowseGroup[] {
  const known = new Set(GROUPS.map(([k]) => k));
  const out: BrowseGroup[] = GROUPS.map(([key, title]) => ({ key, title, items: list.filter((c) => c.category === key) }));
  out.push({ key: 'more', title: 'More to explore', items: list.filter((c) => !known.has(c.category ?? '') && c.category !== 'music_plus') });
  return out.filter((g) => g.items.length > 0);
}

/** The category's kind for a header label: "Mood", "Genre", "Category". */
export function categoryKind(c: Pick<BrowseCategory, 'category'>): string {
  if (c.category === 'mood') return 'Mood';
  if (c.category === 'genre') return 'Genre';
  return 'Category';
}

/** A curated mood's tone when the name matches one, else a steady tone from the id. */
export function categoryTone(c: Pick<BrowseCategory, 'id' | 'name'>): string {
  const named = MOOD_TONES[c.name.toLowerCase()];
  if (named) return `vx-tone-${named}`;
  let h = 0;
  for (const ch of c.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `vx-tone-${(h % 12) + 1}`;
}

/** A small cover for a tile, or null when the catalogue has none. */
export function categoryArt(c: Pick<BrowseCategory, 'images'>, size = 150): string | null {
  const src = bestImage(c.images, size);
  return src && src !== FALLBACK_ART ? src : null;
}
