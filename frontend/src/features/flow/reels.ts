import type { Video } from '@/services/api/videos';

/**
 * 1.14.4 — Flow plays music videos, one per screen, like reels. These are
 * the feed's list rules, kept pure so they are testable.
 *
 * 1.14.5 — what the live video search does (checked 2026-11-16):
 *  - "<language> video songs" browses EVERY video in that language (Telugu
 *    1,282, Hindi 4,986, Kannada 149) and any filler word ("songs", "hits",
 *    "new") answers the very same list. Before 1.14.5 Flow read page 1 of it
 *    first on every visit, so every visit opened on the same reels; now each
 *    visit reads its own random pages of that list.
 *  - A bare mood word ("party", "love") matches titles in every language
 *    (English, Tamil, German, "Unknown"), so moods ask "<language> <mood>".
 *  - Otherwise the search matches TITLES, so a song's title finds its video.
 *    Only titles of songs in the listener's languages are asked.
 *
 * The feed is APPEND-ONLY: the reel on screen never moves. Reels watched on
 * an earlier visit are held back and join only when nothing new is left.
 */

/** The language browse: every video in that language. */
export const browseQuery = (l: string): string => `${l} video songs`;
/** Mood searches that find videos in Telugu and Hindi ("romantic", "melody", "folk" find no Telugu ones). */
const MOODS = ['love', 'dance', 'party', 'mass', 'sad'];
/** Pages to pick from before the API has said how many a search has (the smallest language browse has 11). */
const GUESS_BROWSE_PAGES = 10;
const GUESS_MOOD_PAGES = 2;

/** The titles a search should use: a song's name without "(From 'Film')", "(feat. …)", "[…]", "- Remix"… */
export function searchableTitle(title: string): string {
  return title
    .replace(/\s*[([](?:from|from the|feat|ft)\b.*$/i, ' ')
    .replace(/\s*\([^)]*\)/g, ' ')
    .replace(/\s*\[[^\]]*\]/g, ' ')
    .replace(/["“”()[\]]/g, ' ')
    .replace(/\s*[-–—]\s*(male|female|reprise|remix|version[^,]*|lofi|unplugged)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * One reel per song: "Kesariya (Lyric Video)", "Kesariya (From 'Brahmastra')"
 * and "Kesariya (Lyric Video (Version, 02))" are the same song, so only the
 * first one found joins.
 */
export function reelKey(v: Pick<Video, 'title' | 'songIds'>): string {
  const base = v.title
    .toLowerCase()
    .replace(/\s*\([^)]*\)?/g, ' ')
    .replace(/\s*\[[^\]]*\]?/g, ' ')
    .replace(/\s*[-–—|].*$/, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return base || (v.songIds[0] ?? v.title);
}

/** A reel Flow can play: it has a clip. */
export function playableReel(v: Video | null | undefined): v is Video {
  return !!v && !!(v.previewUrl || v.streamUrl);
}

/** The clip a reel plays, best first: the preview (always served), then the full stream. */
export function reelSources(v: Video): string[] {
  return [...new Set([v.previewUrl, v.streamUrl].filter((u): u is string => !!u))];
}

/* ------------------------------------------------------------------ pages */

/** What one visit knows about a search's pages: how many there are (once asked) and which it has read. */
export interface PageState {
  pages: number | null;
  used: Set<number>;
}
export type PageBook = Map<string, PageState>;

/**
 * The pages a search has, from the API's total. The last partial page is
 * left out: at the end of a list the API starts again from page 1.
 */
export function pageCount(total: number, perPage: number): number {
  return Math.max(1, Math.floor(total / Math.max(1, perPage)));
}

/** A random page not read yet this visit (any page once all were read). */
export function pickPage(pages: number, used: ReadonlySet<number>, rand: () => number): number {
  const n = Math.max(1, Math.floor(pages));
  const free: number[] = [];
  for (let p = 1; p <= n; p += 1) if (!used.has(p)) free.push(p);
  const from = free.length ? free : Array.from({ length: n }, (_, k) => k + 1);
  return from[Math.min(from.length - 1, Math.floor(rand() * from.length))];
}

export interface QueryPlanInput {
  /** The listener's languages, most important first (lower case ids). */
  languages: readonly string[];
  /** Titles of songs in those languages to look up, freshest first. */
  titles: readonly string[];
  /** Which round of loading this is (0 = the first screen). */
  round: number;
  /** Titles already asked this visit. */
  asked: ReadonlySet<string>;
  /** Pages known and read so far this visit, per search. */
  book: ReadonlyMap<string, PageState>;
  /** 0 ≤ n < 1; Math.random in the app, fixed in tests. */
  rand: () => number;
}

export interface ReelQuery {
  query: string;
  page: number;
}

/**
 * The searches for one round: a random unread page of each language's
 * browse, one "<language> <mood>" search (the languages and moods take
 * turns) and up to three song titles not asked yet.
 */
export function reelQueries(i: QueryPlanInput): ReelQuery[] {
  const out: ReelQuery[] = [];
  const langs = (i.languages.length ? i.languages : ['hindi']).slice(0, 3);
  const page = (query: string, guess: number) => {
    const st = i.book.get(query);
    return pickPage(st?.pages ?? guess, st?.used ?? new Set(), i.rand);
  };
  for (const l of langs) {
    const q = browseQuery(l);
    out.push({ query: q, page: page(q, GUESS_BROWSE_PAGES) });
  }
  const mood = `${langs[i.round % langs.length]} ${MOODS[i.round % MOODS.length]}`;
  out.push({ query: mood, page: page(mood, GUESS_MOOD_PAGES) });
  let titles = 0;
  for (const t of i.titles) {
    if (titles >= 3) break;
    const q = searchableTitle(t);
    if (!q || i.asked.has(q.toLowerCase())) continue;
    out.push({ query: q, page: 1 });
    titles += 1;
  }
  return out;
}

/** Note that a page was asked (so the next round picks another one). */
export function notePageAsked(book: PageBook, q: ReelQuery): void {
  const st = book.get(q.query) ?? { pages: null, used: new Set<number>() };
  st.used.add(q.page);
  book.set(q.query, st);
}

/** Note how many pages a search has, from the total its answer carried. */
export function notePageCount(book: PageBook, query: string, total: number, perPage: number): void {
  if (!total) return;
  const st = book.get(query) ?? { pages: null, used: new Set<number>() };
  st.pages = pageCount(total, perPage);
  book.set(query, st);
}

/* ------------------------------------------------------------------ feed */

export interface AppendOptions {
  /** The listener's languages; only reels labelled with one of them join (an unlabelled reel is often English). */
  languages: readonly string[];
  /** Reels watched on an earlier visit. */
  seen: ReadonlySet<string>;
  /** Let reels watched before join (when nothing new is left). */
  includeSeen?: boolean;
}

export interface AppendResult {
  reels: Video[];
  /** Reels watched before that were held back (they can join later, when nothing new is left). */
  held: Video[];
}

/**
 * The feed after `incoming` arrives: `current` unchanged, then the new reels
 * that can play, are in the listener's languages, are not a second copy of a
 * song already in the feed, and were not watched before (unless includeSeen).
 */
export function appendReels(current: readonly Video[], incoming: readonly Video[], opts: AppendOptions): AppendResult {
  const ids = new Set(current.map((v) => v.id));
  const keys = new Set(current.map(reelKey));
  const langs = new Set(opts.languages.map((l) => l.toLowerCase()));
  const fresh: Video[] = [];
  const held: Video[] = [];
  for (const v of incoming) {
    if (!playableReel(v) || ids.has(v.id)) continue;
    const lang = v.language?.toLowerCase() ?? null;
    if (langs.size && (!lang || !langs.has(lang))) continue;
    const key = reelKey(v);
    if (keys.has(key)) continue;
    if (opts.seen.has(v.id) && !opts.includeSeen) {
      held.push(v);
      continue;
    }
    ids.add(v.id);
    keys.add(key);
    fresh.push(v);
  }
  return { reels: fresh.length ? [...current, ...fresh] : (current as Video[]), held };
}

/**
 * The feed opened on one asked-for video (/flow?v=<id>): that video first,
 * whatever its language or whether it was watched before, then the rest
 * without a second copy of its song. Flow calls this before the first round
 * lands, so no reel on screen moves.
 */
export function withLead(current: readonly Video[], lead: Video): Video[] {
  if (current.some((v) => v.id === lead.id)) return current as Video[];
  const key = reelKey(lead);
  return [lead, ...current.filter((v) => reelKey(v) !== key)];
}

/** The in-app address that opens Flow on one video (shared links, Videos cards, old /video/<id> links). */
export function flowVideoPath(id: string): string {
  return `/flow?v=${encodeURIComponent(id)}`;
}

/* ------------------------------------------------------- watched on this device */

export const SEEN_KEY = 'vinax.flow.seen.v1';
export const SEEN_CAP = 500;

export function readSeen(): Set<string> {
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

/** Remember that a reel was on screen long enough to count as watched. */
export function markSeen(id: string): void {
  try {
    const list = [...readSeen()].filter((x) => x !== id);
    list.push(id);
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(list.slice(-SEEN_CAP)));
  } catch {
    /* no storage: every visit is a first visit */
  }
}
