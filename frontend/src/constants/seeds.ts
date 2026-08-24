/**
 * Deterministic discovery seed queries. The upstream wrappers expose search
 * reliably but trending/module endpoints inconsistently, so trending shelves
 * are sourced through language- and mood-aware search seeds and then ranked
 * locally. Year is computed so seeds stay fresh without code changes.
 */
const YEAR = new Date().getFullYear();

const TRENDING_VARIANTS = [
  'top {l} songs {y}',
  'best {l} songs {y}',
  '{l} hit songs',
  '{l} trending now',
  '{l} popular songs',
  '{l} superhits {y}',
  '{l} chartbusters',
];

export function trendingSeed(language: string, salt = 0): string {
  const label = language === 'unknown' ? '' : language;
  const tpl = TRENDING_VARIANTS[Math.abs(salt) % TRENDING_VARIANTS.length];
  return tpl.replace('{l}', label).replace('{y}', String(YEAR)).replace(/\s+/g, ' ').trim();
}

const NEW_VARIANTS = [
  'new {l} songs {y}',
  'latest {l} releases {y}',
  '{l} new songs this month',
  'fresh {l} tracks {y}',
  '{l} latest hits {y}',
];
export function newReleasesSeed(language: string, salt = 0): string {
  const label = language === 'unknown' ? '' : language;
  const tpl = NEW_VARIANTS[Math.abs(salt) % NEW_VARIANTS.length];
  return tpl.replace('{l}', label).replace('{y}', String(YEAR)).replace(/\s+/g, ' ').trim();
}

const POPULAR_VARIANTS = [
  'popular {l} songs',
  'most played {l} songs {y}',
  '{l} all time hits',
  'best {l} songs',
  '{l} blockbuster hits',
];
/** Most-popular songs — varies phrasing by salt. */
export function popularSeed(language: string, salt = 0): string {
  const label = language === 'unknown' ? '' : language;
  const tpl = POPULAR_VARIANTS[Math.abs(salt) % POPULAR_VARIANTS.length];
  return tpl.replace('{l}', label).replace('{y}', String(YEAR)).replace(/\s+/g, ' ').trim();
}

/** Endless home-feed seed — phrased differently from trendingSeed so the
 * feed doesn't mirror the Trending shelf. */
export function feedSeed(language: string): string {
  const label = language === 'unknown' ? '' : language;
  return `${label} superhit songs`.trim();
}

export const MOODS = [
  { id: 'romance', label: 'Romance', emoji: '❤️', query: 'romantic hits' },
  { id: 'workout', label: 'Workout', emoji: '💪', query: 'workout gym motivation songs' },
  { id: 'chill', label: 'Chill', emoji: '🌙', query: 'chill lofi relax songs' },
  { id: 'party', label: 'Party', emoji: '🎉', query: 'party dance hits' },
  { id: 'sad', label: 'Heartbreak', emoji: '💧', query: 'sad heartbreak songs' },
  { id: 'devotional', label: 'Devotional', emoji: '🕊️', query: 'devotional bhajan songs' },
  { id: 'travel', label: 'Road Trip', emoji: '🚗', query: 'road trip driving songs' },
  { id: 'focus', label: 'Focus', emoji: '🎯', query: 'instrumental focus study music' },
] as const;

export function moodSeed(moodId: string, language?: string | null): string {
  const mood = MOODS.find((m) => m.id === moodId);
  if (!mood) return trendingSeed(language ?? 'hindi');
  return language && language !== 'unknown' ? `${language} ${mood.query}` : mood.query;
}

export function timeOfDaySeed(hour: number, language: string): { title: string; query: string } {
  if (hour >= 5 && hour < 11) return { title: 'Morning Picks', query: `${language} morning fresh songs` };
  if (hour >= 11 && hour < 17) return { title: 'Daytime Energy', query: `${language} feel good hits` };
  if (hour >= 17 && hour < 22) return { title: 'Evening Unwind', query: `${language} evening melodies` };
  return { title: 'Night Vibes', query: `${language} late night chill songs` };
}
