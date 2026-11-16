import type { Song } from '@/types';

/**
 * 1.15 — the queue rules, the way Spotify plays them.
 *
 * The upcoming part of the queue reads in three runs:
 *
 *  1. Next in queue — songs the listener added ("Add to queue", "Play next").
 *     They play right after the current song, in the order they were added,
 *     ahead of the rest of the album or playlist.
 *  2. Next from <what you started> — the album, playlist or page the listener
 *     pressed play on.
 *  3. Autoplay — what VinaX picked to keep the music going once the list ends.
 *
 * Shuffle reorders run 2 once, when it is switched on (the listener's own adds
 * stay on top, Autoplay stays last), so the queue on screen IS the order that
 * plays and Back returns to the song before. Switching it off puts the list
 * back in its original order, carrying on from the song that was playing.
 */

export type QueueRun = 'manual' | 'list' | 'auto';

/** Where the songs came from, for "Playing from" and "Next from". */
export interface QueueContext {
  kind: 'album' | 'playlist' | 'artist' | 'liked' | 'search' | 'radio' | 'home' | 'history' | 'page';
  label: string;
  path?: string;
}

/** Where "Add to queue" puts a song: after the current one and every song already added by hand. */
export function queueInsertAt(queue: readonly Song[], index: number, isManual: (id: string) => boolean): number {
  let at = Math.min(Math.max(0, index + 1), queue.length);
  while (at < queue.length && isManual(queue[at].id)) at += 1;
  return at;
}

/** Fisher–Yates on a copy. `rand` is injectable for tests. */
export function shuffleSongs<T>(items: readonly T[], rand: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function split(tail: readonly Song[], runOf: (id: string) => QueueRun): Record<QueueRun, Song[]> {
  const runs: Record<QueueRun, Song[]> = { manual: [], list: [], auto: [] };
  for (const s of tail) runs[runOf(s.id)].push(s);
  return runs;
}

/** Shuffle switched on: the list after the current song is shuffled; adds stay first, Autoplay last. */
export function shuffleUpcoming(queue: readonly Song[], index: number, runOf: (id: string) => QueueRun, rand: () => number = Math.random): Song[] {
  const runs = split(queue.slice(index + 1), runOf);
  return [...queue.slice(0, index + 1), ...runs.manual, ...shuffleSongs(runs.list, rand), ...runs.auto];
}

/**
 * Shuffle switched off: the list's songs still to come go back to the order
 * they had when the listener started it, carrying on from the last list song
 * heard (the ones after it first, then any earlier ones not played yet).
 * Songs the list never had keep their place at the end of the run.
 */
export function unshuffleUpcoming(queue: readonly Song[], index: number, order: readonly string[], runOf: (id: string) => QueueRun): Song[] {
  const rank = new Map<string, number>();
  order.forEach((id, i) => {
    if (!rank.has(id)) rank.set(id, i);
  });
  let from = -1;
  for (let i = index; i >= 0; i -= 1) {
    const r = rank.get(queue[i]?.id);
    if (r !== undefined) {
      from = r;
      break;
    }
  }
  const runs = split(queue.slice(index + 1), runOf);
  const known = runs.list.filter((s) => rank.has(s.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  const after = known.filter((s) => rank.get(s.id)! > from);
  const before = known.filter((s) => rank.get(s.id)! <= from);
  const unknown = runs.list.filter((s) => !rank.has(s.id));
  return [...queue.slice(0, index + 1), ...runs.manual, ...after, ...before, ...unknown, ...runs.auto];
}

/** A list started with shuffle on: the chosen song first, every other song after it in a random order. */
export function shuffledStart(list: readonly Song[], seed: Song, rand: () => number = Math.random): Song[] {
  return [seed, ...shuffleSongs(list.filter((s) => s !== seed), rand)];
}

const APP_SUFFIX = /\s+·\s+VinaX$/;
const NO_CONTEXT = new Set(['/now-playing', '/queue', '/settings', '/together']);

/**
 * What the listener pressed play on, read from the page they were on: the
 * route says what kind of thing it is, the page title (set by usePageTitle as
 * "<name> · VinaX") says its name. Pages with no title of their own, and
 * pages that are not a place songs come from, give nothing.
 */
export function inferContext(pathname: string, title: string): QueueContext | null {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (NO_CONTEXT.has(path)) return null;
  const name = title.replace(APP_SUFFIX, '').trim();
  const named = name && name !== 'VinaX' ? name : '';
  if (path === '/') return { kind: 'home', label: 'Home', path };
  if (path === '/favorites') return { kind: 'liked', label: 'Liked songs', path };
  if (path === '/history') return { kind: 'history', label: 'Recently played', path };
  if (path === '/search' || path.startsWith('/search/')) {
    const q = path.startsWith('/search/') ? decodeURIComponent(path.slice('/search/'.length)).trim() : '';
    return { kind: 'search', label: q ? `Search: ${q}` : 'Search', path };
  }
  if (!named) return null;
  if (path.startsWith('/album/')) return { kind: 'album', label: named, path };
  if (path.startsWith('/artist/')) return { kind: 'artist', label: named, path };
  if (/^\/(playlist|p|collection|smart)\//.test(path)) return { kind: 'playlist', label: named, path };
  return { kind: 'page', label: named, path };
}

/** The context the current page gives, or null outside a browser. */
export function contextFromPage(): QueueContext | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  try {
    return inferContext(window.location.pathname, document.title);
  } catch {
    return null;
  }
}

/** localStorage is untrusted: a stored context must have this exact shape. */
export function isQueueContext(v: unknown): v is QueueContext {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.kind === 'string' &&
    ['album', 'playlist', 'artist', 'liked', 'search', 'radio', 'home', 'history', 'page'].includes(c.kind) &&
    typeof c.label === 'string' &&
    c.label.length > 0 &&
    c.label.length <= 200 &&
    (c.path === undefined || (typeof c.path === 'string' && c.path.startsWith('/')))
  );
}
