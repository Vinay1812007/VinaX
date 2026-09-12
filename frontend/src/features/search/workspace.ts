import type { Song } from '@/types';

export interface SearchFilters {
  decade: string;
  duration: 'any' | 'short' | 'medium' | 'long';
  lyrics: boolean;
  clean: boolean;
  favorites: boolean;
  unheard: boolean;
}
export const DEFAULT_FILTERS: SearchFilters = {
  decade: '',
  duration: 'any',
  lyrics: false,
  clean: false,
  favorites: false,
  unheard: false,
};

export function sanitizeFilters(value: unknown): SearchFilters {
  const p = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    decade: typeof p.decade === 'string' && /^(19[5-9]0|20[0-2]0)$/.test(p.decade) ? p.decade : '',
    duration:
      p.duration === 'short' || p.duration === 'medium' || p.duration === 'long'
        ? p.duration
        : 'any',
    lyrics: p.lyrics === true,
    clean: p.clean === true,
    favorites: p.favorites === true,
    unheard: p.unheard === true,
  };
}

export function refineSongs(
  songs: Song[],
  filters: SearchFilters,
  favorites: Set<string>,
  heard: Set<string>,
): Song[] {
  return songs.filter((s) => {
    const year = s.year ? Number(s.year) : NaN;
    if (
      filters.decade &&
      (!Number.isFinite(year) || year < +filters.decade || year >= +filters.decade + 10)
    )
      return false;
    if (filters.duration !== 'any') {
      if (s.duration == null || s.duration <= 0) return false;
      if (filters.duration === 'short' && s.duration >= 180) return false;
      if (filters.duration === 'medium' && (s.duration < 180 || s.duration > 300)) return false;
      if (filters.duration === 'long' && s.duration <= 300) return false;
    }
    return (
      (!filters.lyrics || s.hasLyrics) &&
      (!filters.clean || !s.explicit) &&
      (!filters.favorites || favorites.has(s.id)) &&
      (!filters.unheard || !heard.has(s.id))
    );
  });
}

export function activeFilterCount(filters: SearchFilters): number {
  return (
    Number(!!filters.decade) +
    Number(filters.duration !== 'any') +
    ['lyrics', 'clean', 'favorites', 'unheard'].filter((k) => filters[k as keyof SearchFilters])
      .length
  );
}

/** Quoted CSV cells also neutralize spreadsheet formula prefixes. */
export function resultsCsv(songs: Song[]): string {
  const cell = (value: unknown) => {
    let text = String(value ?? '');
    if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  return [
    ['Title', 'Artist', 'Album', 'Language', 'Year', 'Seconds'],
    ...songs.map((s) => [s.title, s.subtitle, s.album?.name, s.language, s.year, s.duration]),
  ]
    .map((row) => row.map(cell).join(','))
    .join('\r\n');
}

export function shuffledSongs(songs: Song[]): Song[] {
  const out = [...songs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
