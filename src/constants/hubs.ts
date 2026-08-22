/**
 * Mood × language hub pages — the category-landing-page layer (the same play
 * JioSaavn/Gaana use to own "<language> <mood> songs" queries). Each entry
 * becomes 12 routes (one per HUB_LANGUAGE): /telugu-romantic-songs, etc.
 * KEEP IN SYNC with functions/_lib/render.ts (edge meta) and
 * functions/sitemap-hubs.xml.ts — Pages Functions cannot import src/.
 */
export interface MoodHub {
  /** URL slug segment: /<lang>-<slug>-songs */
  slug: string;
  label: string;
  /** Catalog seed appended to the language ("telugu romantic hits"). */
  query: string;
  /** One-line hub description flavor. */
  blurb: string;
}

export const MOOD_HUBS: MoodHub[] = [
  { slug: 'romantic', label: 'Romantic', query: 'romantic hits', blurb: 'love songs and melodies for every heartbeat' },
  { slug: 'sad', label: 'Sad', query: 'sad heartbreak songs', blurb: 'heartbreak and healing, one song at a time' },
  { slug: 'party', label: 'Party', query: 'party dance hits', blurb: 'dance-floor anthems and beat drops' },
  { slug: 'devotional', label: 'Devotional', query: 'devotional bhajan songs', blurb: 'bhajans and devotional classics' },
  { slug: 'melody', label: 'Melody', query: 'melody hits', blurb: 'timeless melodies, soft and soulful' },
  { slug: 'workout', label: 'Workout', query: 'workout gym motivation songs', blurb: 'high-energy tracks that keep you moving' },
];
