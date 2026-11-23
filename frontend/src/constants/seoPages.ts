/**
 * SEO 2026-11-23 — the browse pages' titles and descriptions, in the words
 * people search with ("trending songs 2026", "new telugu songs"), the way
 * JioSaavn's pages are worded. scripts/prerender.mjs writes them into the
 * static pages and the app sets the same ones, so what a crawler reads and
 * what it sees after the app starts agree. " · VinaX" is added after each
 * title, so a title here stays within 62 characters (70 in all).
 */
export interface PageSeo {
  t: string;
  d: string;
  h1: string;
  more?: string;
}

export const SEO_YEAR = new Date().getFullYear();

const cap = (w: string): string => w.charAt(0).toUpperCase() + w.slice(1);

export const LIST_PAGE_SEO: Record<string, PageSeo> = {
  '/trending': {
    t: `Trending Songs ${SEO_YEAR} - Hindi, Telugu & Tamil Hits`,
    d: 'Trending songs right now: the Hindi, Telugu, Tamil, Punjabi and other hits everyone is playing this week. Listen to trending songs online free on VinaX.',
    h1: 'Trending Songs',
    more: 'The list follows what people play most, so it changes through the week. Each song opens with its singers, film, music director and lyrics.',
  },
  '/new-releases': {
    t: `New Songs ${SEO_YEAR} - Latest Hindi, Telugu & Tamil Songs`,
    d: `Listen to new songs of ${SEO_YEAR} online: the latest Hindi, Telugu, Tamil, Punjabi and other film songs and albums as they release. Stream free on VinaX.`,
    h1: `New Songs ${SEO_YEAR}`,
    more: 'New albums and new songs are listed separately, so you can go straight to what came out most recently. Every song page names its film, singers and music director.',
  },
  '/top-songs': {
    t: `Top Songs ${SEO_YEAR} - Most Played Hindi, Telugu & Tamil Songs`,
    d: `The top songs of ${SEO_YEAR}: the most played Hindi, Telugu, Tamil, Punjabi and other songs on VinaX right now. Listen to the top hits online free.`,
    h1: `Top Songs ${SEO_YEAR}`,
  },
  '/charts': {
    t: 'Top Charts - Top 10 Songs in Hindi, Telugu, Tamil & More',
    d: 'Music charts for India: the top 10 songs in Hindi, Telugu, Tamil, Punjabi, Kannada, Malayalam and more, updated daily. Listen free on VinaX.',
    h1: 'Top Charts',
  },
};

/** A language page ("/telugu-songs"): "Telugu Songs 2026 - Latest Telugu Hit Songs Online". */
export function languagePageSeo(lang: string): PageSeo {
  const L = cap(lang);
  const long = `${L} Songs ${SEO_YEAR} - Latest ${L} Hit Songs Online`;
  return {
    t: long.length <= 62 ? long : `${L} Songs ${SEO_YEAR} - Latest ${L} Hits`,
    d: `Listen to the latest ${L} songs of ${SEO_YEAR} online: trending ${L} hits, new ${L} movie songs and evergreen favourites. Stream free on VinaX.`,
    h1: `${L} Songs`,
  };
}

/**
 * A mood page ("/telugu-romantic-songs"): the same words as moodTitle /
 * moodDesc in backend/worker/functions/_lib/render.ts (keep in sync). The
 * title already ends with "| VinaX", so the app does not add it again.
 */
export function moodPageSeo(label: string, mood: string, blurb: string, year = SEO_YEAR): { t: string; d: string } {
  const L = cap(label);
  const t =
    [`${L} ${mood} Songs ${year} - Best ${L} ${mood} Hits | VinaX`, `${L} ${mood} Songs ${year} - Best ${mood} Hits | VinaX`].find((x) => x.length <= 70) ??
    `${L} ${mood} Songs ${year} | VinaX`;
  const first = `Listen to the best ${L} ${mood.toLowerCase()} songs of ${year} online: ${blurb}.`;
  const more = 'Stream them free on VinaX, with no subscription.';
  return { t, d: `${first} ${more}`.length <= 160 ? `${first} ${more}` : first };
}
