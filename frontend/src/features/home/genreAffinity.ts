/**
 * 8.2.0 — the listener's genre affinity, read for Home.
 *
 * The input is the genre map of the on-device recommendation profile
 * (`buildUserRecommendationProfile(...).genres`): catalogue genres and genres
 * read from titles, weighted by likes and recent plays. Everything here is
 * pure so the Home shelves and the block order can be tested without a
 * catalogue.
 *
 * Catalogue queries stay short on purpose: "<language> <word> songs" is the
 * shape probed against the catalogue (see tuneSearchQuery in
 * services/recommendation/tune.ts) — longer phrases often return nothing.
 */

export interface GenreDef {
  /** Canonical id (matches the recommendation profile's genre keys where they exist). */
  id: string;
  /** Sentence-case label for a shelf title. */
  label: string;
  /** The one catalogue word that stands for it in "<language> <word> songs". */
  word: string;
}

export const GENRE_DEFS: readonly GenreDef[] = [
  { id: 'romantic', label: 'Melody', word: 'melody' },
  { id: 'dance', label: 'Dance', word: 'dance' },
  { id: 'devotional', label: 'Devotional', word: 'devotional' },
  { id: 'hip-hop', label: 'Hip hop', word: 'rap' },
  { id: 'rock', label: 'Rock', word: 'rock' },
  { id: 'classical', label: 'Classical', word: 'classical' },
  { id: 'chill', label: 'Chill', word: 'lofi' },
  { id: 'pop', label: 'Pop', word: 'pop' },
  { id: 'folk', label: 'Folk', word: 'folk' },
];

/** Other spellings the catalogue or the title reader use for the same genre. */
const ALIASES: Record<string, string> = {
  romance: 'romantic',
  love: 'romantic',
  melody: 'romantic',
  melodies: 'romantic',
  ballad: 'romantic',
  edm: 'dance',
  electronic: 'dance',
  club: 'dance',
  party: 'dance',
  bhajan: 'devotional',
  spiritual: 'devotional',
  hiphop: 'hip-hop',
  'hip hop': 'hip-hop',
  rap: 'hip-hop',
  lofi: 'chill',
  'lo-fi': 'chill',
  ambient: 'chill',
  acoustic: 'chill',
  indipop: 'pop',
  'indie pop': 'pop',
};

const BY_ID = new Map(GENRE_DEFS.map((g) => [g.id, g]));

/** The canonical genre id for a raw genre key, or null when Home has no shelf for it. */
export function canonicalGenre(raw: string): string | null {
  const key = raw.trim().toLowerCase();
  if (!key) return null;
  if (BY_ID.has(key)) return key;
  const alias = ALIASES[key];
  return alias && BY_ID.has(alias) ? alias : null;
}

/** Canonical genres with their summed affinity, strongest first (ties by id, so the order is stable). */
export function rankGenres(genres: Record<string, number> | null | undefined): Array<{ id: string; score: number }> {
  const sums = new Map<string, number>();
  for (const [raw, score] of Object.entries(genres ?? {})) {
    if (!(score > 0) || !Number.isFinite(score)) continue;
    const id = canonicalGenre(raw);
    if (id) sums.set(id, (sums.get(id) ?? 0) + score);
  }
  return [...sums.entries()].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

export interface GenreShelfPick {
  id: string;
  label: string;
  query: string;
  score: number;
}

/**
 * The listener's top genres as Home shelves, in their language. A genre
 * needs `minScore` of affinity (a couple of liked or played songs) before it
 * earns a shelf, so a cold profile shows none.
 */
export function topGenreShelves(genres: Record<string, number> | null | undefined, language: string | null | undefined, n = 2, minScore = 2): GenreShelfPick[] {
  const lang = (language ?? '').trim().toLowerCase();
  const prefix = lang && lang !== 'unknown' ? `${lang} ` : '';
  return rankGenres(genres)
    .filter((g) => g.score >= minScore)
    .slice(0, Math.max(0, n))
    .map((g) => {
      const def = BY_ID.get(g.id)!;
      return { id: g.id, label: def.label, query: `${prefix}${def.word} songs`, score: g.score };
    });
}

/** How concentrated the listener's taste is: the top genre's share of all known genre affinity (0..1). */
export function genreAffinityStrength(genres: Record<string, number> | null | undefined): number {
  const ranked = rankGenres(genres);
  const total = ranked.reduce((sum, g) => sum + g.score, 0);
  return total > 0 ? ranked[0].score / total : 0;
}

/** Which affinity a Home genre tile stands for: a genre, or a language. */
const TILE_GENRE: Record<string, string> = { pop: 'pop', hiphop: 'hip-hop', rock: 'rock', edm: 'dance', classical: 'classical', lofi: 'chill' };
const TILE_LANGUAGE: Record<string, string> = { telugu: 'telugu', tamil: 'tamil', bollywood: 'hindi', punjabi: 'punjabi' };

/**
 * Put the genre tiles the listener actually leans towards first. Genre and
 * language affinities are on different scales, so each is read relative to
 * its own strongest value. Tiles with no affinity keep their original order
 * after the ones with some.
 */
export function rankGenreTiles<T extends { id: string }>(tiles: readonly T[], genres: Record<string, number> | null | undefined, languages: Record<string, number> | null | undefined): T[] {
  const g = new Map(rankGenres(genres).map((x) => [x.id, x.score]));
  const gMax = Math.max(0, ...g.values());
  const l = languages ?? {};
  const lMax = Math.max(0, ...Object.values(l).filter((v) => Number.isFinite(v)));
  const weight = (tile: T): number => {
    const genre = TILE_GENRE[tile.id];
    if (genre && gMax > 0) return (g.get(genre) ?? 0) / gMax;
    const lang = TILE_LANGUAGE[tile.id];
    if (lang && lMax > 0) return Math.max(0, l[lang] ?? 0) / lMax;
    return 0;
  };
  return tiles
    .map((tile, i) => ({ tile, i, w: weight(tile) }))
    .sort((a, b) => b.w - a.w || a.i - b.i)
    .map((x) => x.tile);
}
