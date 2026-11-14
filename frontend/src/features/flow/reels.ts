import type { Video } from '@/services/api/videos';

/**
 * 1.14.4 — Flow plays music videos, one per screen, like reels. These are
 * the feed's list rules, kept pure so they are testable.
 *
 * The video search matches TITLES (checked on the live API: a song's title
 * finds its video and the film's other videos; an artist's name finds
 * nothing), so the feed asks with the titles of songs the listener already
 * has in front of them (the Daily mix, Trending, their likes), mixed with
 * a few plain searches in their languages that page deeper as they scroll.
 *
 * The feed is APPEND-ONLY: the reel on screen never moves. Reels watched on
 * an earlier visit go after the ones not seen yet.
 */

/** Plain searches per language; each round reads the next page (the API's pages start at 1). */
const LANGUAGE_TEMPLATES: ReadonlyArray<(l: string) => string> = [
  (l) => `${l} video songs`,
  (l) => `${l} lyric video`,
  (l) => `${l} video`,
];
/** Plain searches that work in any language. */
const MOOD_QUERIES = ['party', 'love', 'dance', 'romantic', 'melody', 'mass'];

/** The titles a search should use: a song's name without "(From 'Film')", "(feat. …)", "- Remix"… */
export function searchableTitle(title: string): string {
  return title
    .replace(/\s*\((?:from|from the)\b[^)]*\)/gi, ' ')
    .replace(/\s*\((?:feat|ft)\.?[^)]*\)/gi, ' ')
    .replace(/\s*[-–—]\s*(male|female|reprise|remix|version[^,]*|lofi|unplugged)$/i, '')
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

export interface QueryPlanInput {
  /** The listener's languages, most important first (lower case ids). */
  languages: readonly string[];
  /** Song titles to look up, freshest first. */
  titles: readonly string[];
  /** Which round of loading this is (0 = the first screen). */
  round: number;
  /** Titles already asked this visit. */
  asked: ReadonlySet<string>;
}

export interface ReelQuery {
  query: string;
  page: number;
}

/**
 * The searches for one round: up to four song titles not asked yet, one
 * plain search per language (a deeper page each round) and one mood search.
 */
export function reelQueries(i: QueryPlanInput): ReelQuery[] {
  const out: ReelQuery[] = [];
  const langs = (i.languages.length ? i.languages : ['hindi']).slice(0, 3);
  let titles = 0;
  for (const t of i.titles) {
    if (titles >= 4) break;
    const q = searchableTitle(t);
    if (!q || i.asked.has(q.toLowerCase())) continue;
    out.push({ query: q, page: 1 });
    titles += 1;
  }
  const tpl = LANGUAGE_TEMPLATES[i.round % LANGUAGE_TEMPLATES.length];
  const page = 1 + Math.floor(i.round / LANGUAGE_TEMPLATES.length);
  for (const l of langs) out.push({ query: tpl(l), page });
  out.push({ query: MOOD_QUERIES[i.round % MOOD_QUERIES.length], page: 1 + Math.floor(i.round / MOOD_QUERIES.length) });
  return out;
}

export interface AppendOptions {
  /** The listener's languages; a reel in another known language is left out (unknown passes). */
  languages: readonly string[];
  /** Reels watched on an earlier visit: they join after the unseen ones. */
  seen: ReadonlySet<string>;
}

/**
 * The feed after `incoming` arrives: `current` unchanged, then the new reels
 * that can play, are in the listener's languages, and are not a second copy
 * of a song already in the feed. Unseen reels first, then the ones seen before.
 */
export function appendReels(current: readonly Video[], incoming: readonly Video[], opts: AppendOptions): Video[] {
  const ids = new Set(current.map((v) => v.id));
  const keys = new Set(current.map(reelKey));
  const langs = new Set(opts.languages.map((l) => l.toLowerCase()));
  const fresh: Video[] = [];
  const again: Video[] = [];
  for (const v of incoming) {
    if (!playableReel(v) || ids.has(v.id)) continue;
    const lang = v.language?.toLowerCase() ?? null;
    if (lang && langs.size && !langs.has(lang)) continue;
    const key = reelKey(v);
    if (keys.has(key)) continue;
    ids.add(v.id);
    keys.add(key);
    (opts.seen.has(v.id) ? again : fresh).push(v);
  }
  return fresh.length || again.length ? [...current, ...fresh, ...again] : (current as Video[]);
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
