import type { Song } from '@/types';

/**
 * 1.20 — the queue, rebuilt to work the way Spotify's does.
 *
 * The queue is one flat list, `queue`, with `index` on the song playing and a
 * parallel list, `runs`, saying where each entry came from. Everything before
 * `index` has played (or was skipped past); everything after it plays in
 * exactly the order it is listed, in three runs:
 *
 *  1. Next in queue ('queued') — songs the listener added with Add to queue.
 *     They play right after the current song, in the order they were added,
 *     and they stay when the listener starts a different album or playlist.
 *     Each plays once.
 *  2. Next from <what you played> ('context') — the album, playlist, artist or
 *     page the listener pressed play on. Shuffle reorders this run only.
 *     Repeat all plays it again from the top.
 *  3. Autoplay ('autoplay') — songs like the ones just played, added once the
 *     list has run out (only with Autoplay on and repeat off).
 *
 * Every function here is pure: it takes a snapshot and returns a new one.
 * Because runs are kept per entry (not per song id), the same song can be in
 * the queue twice, as on Spotify.
 */

export type QueueRun = 'queued' | 'context' | 'autoplay';

export interface QueueSnapshot {
  queue: Song[];
  runs: QueueRun[];
  index: number;
}

/** One upcoming entry with its absolute position in `queue`. */
export interface QueueEntry {
  song: Song;
  run: QueueRun;
  at: number;
}

const RANK: Readonly<Record<QueueRun, number>> = { queued: 0, context: 1, autoplay: 2 };

export function isQueueRun(v: unknown): v is QueueRun {
  return v === 'queued' || v === 'context' || v === 'autoplay';
}

/** Runs read from storage, lined up with the queue: anything missing or malformed is 'context'. */
export function alignRuns(queue: readonly unknown[], runs: unknown): QueueRun[] {
  const raw = Array.isArray(runs) ? runs : [];
  return queue.map((_, i) => (isQueueRun(raw[i]) ? raw[i] : 'context'));
}

/** The entries after the playing song, in play order. */
export function upcoming(s: QueueSnapshot): QueueEntry[] {
  const out: QueueEntry[] = [];
  for (let at = s.index + 1; at < s.queue.length; at += 1) out.push({ song: s.queue[at], run: s.runs[at] ?? 'context', at });
  return out;
}

/** Rebuild a snapshot from the played part (up to and including `index`) and a new upcoming part. */
function withUpcoming(s: QueueSnapshot, next: ReadonlyArray<{ song: Song; run: QueueRun }>): QueueSnapshot {
  return {
    queue: [...s.queue.slice(0, s.index + 1), ...next.map((e) => e.song)],
    runs: [...s.runs.slice(0, s.index + 1), ...next.map((e) => e.run)],
    index: s.index,
  };
}

/**
 * The one invariant: what comes next reads Next in queue, then the list, then
 * Autoplay. A stable sort, so each run keeps its own order.
 */
export function normalize(s: QueueSnapshot): QueueSnapshot {
  const runs = alignRuns(s.queue, s.runs);
  const index = s.queue.length ? Math.min(Math.max(0, s.index), s.queue.length - 1) : 0;
  const base = { queue: s.queue, runs, index };
  const next = upcoming(base);
  const sorted = [...next].sort((a, b) => RANK[a.run] - RANK[b.run] || a.at - b.at);
  return sorted.every((e, i) => e === next[i]) ? base : withUpcoming(base, sorted);
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

/** The lead artist a shuffle keeps apart. */
export function leadKey(song: Song): string {
  return (song.artists?.[0]?.name ?? song.subtitle?.split(',')[0] ?? '').trim().toLowerCase();
}

/**
 * A shuffle that keeps one artist's songs apart: a song that would follow
 * another by the same artist swaps with the next song by someone else (when
 * there is one). Nothing else moves.
 */
export function spreadArtists<T>(items: readonly T[], keyOf: (item: T) => string): T[] {
  const out = [...items];
  for (let i = 1; i < out.length; i += 1) {
    const key = keyOf(out[i]);
    if (!key || key !== keyOf(out[i - 1])) continue;
    const j = out.findIndex((x, n) => n > i && keyOf(x) !== key);
    if (j < 0) break;
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const shuffled = (songs: readonly Song[], rand: () => number): Song[] => spreadArtists(shuffleSongs(songs, rand), leadKey);

/**
 * Play a list (an album, a playlist, a page of songs) from `start`.
 *
 * - In order: the songs before `start` sit behind the playing song, so Back
 *   steps through the list the way it is printed; the rest follow it.
 * - Shuffled: the chosen song plays first and every other song follows in a
 *   random order.
 * - `keepQueued`: the listener's Next in queue survives the new list and
 *   plays right after the chosen song.
 */
export function startList(
  s: QueueSnapshot,
  list: readonly Song[],
  start: number,
  opts: { shuffle?: boolean; keepQueued?: boolean; rand?: () => number } = {},
): QueueSnapshot {
  if (!list.length) return s;
  const at = Math.min(Math.max(0, Math.floor(start)), list.length - 1);
  const seed = list[at];
  const kept = opts.keepQueued ? upcoming(s).filter((e) => e.run === 'queued').map((e) => e.song) : [];
  const before = opts.shuffle ? [] : list.slice(0, at);
  const after = opts.shuffle ? shuffled(list.filter((_, i) => i !== at), opts.rand ?? Math.random) : list.slice(at + 1);
  return {
    queue: [...before, seed, ...kept, ...after],
    runs: [...before.map((): QueueRun => 'context'), 'context', ...kept.map((): QueueRun => 'queued'), ...after.map((): QueueRun => 'context')],
    index: before.length,
  };
}

/** Add to queue: after the playing song and every song already added, so adds play in the order they were made. */
export function addToQueue(s: QueueSnapshot, songs: readonly Song[]): QueueSnapshot {
  if (!songs.length) return s;
  let at = Math.min(s.index + 1, s.queue.length);
  while (at < s.queue.length && s.runs[at] === 'queued') at += 1;
  return {
    queue: [...s.queue.slice(0, at), ...songs, ...s.queue.slice(at)],
    runs: [...s.runs.slice(0, at), ...songs.map((): QueueRun => 'queued'), ...s.runs.slice(at)],
    index: s.index,
  };
}

/** Is this song already waiting in Next in queue? */
export function isQueued(s: QueueSnapshot, id: string): boolean {
  return upcoming(s).some((e) => e.run === 'queued' && e.song.id === id);
}

/**
 * Tap a row to play it.
 *
 * - A row further down: the list and Autoplay songs above it are skipped (they
 *   go behind the playing song, so Back still reaches them). Songs in Next in
 *   queue above it stay and play after it, unless the row tapped is itself in
 *   Next in queue, in which case the ones above it are dropped.
 * - A row already played: the queue steps back to it.
 */
export function jumpTo(s: QueueSnapshot, target: number): QueueSnapshot {
  if (target < 0 || target >= s.queue.length || target === s.index) return s;
  if (target < s.index) return normalize({ ...s, index: target });
  const next = upcoming(s);
  const k = target - s.index - 1;
  const picked = next[k];
  const above = next.slice(0, k);
  const skipped = above.filter((e) => e.run !== 'queued');
  const keptQueued = picked.run === 'queued' ? [] : above.filter((e) => e.run === 'queued');
  const rest = next.slice(k + 1);
  const head = s.queue.slice(0, s.index + 1);
  const headRuns = s.runs.slice(0, s.index + 1);
  const tail = [...keptQueued, ...rest];
  return normalize({
    queue: [...head, ...skipped.map((e) => e.song), picked.song, ...tail.map((e) => e.song)],
    runs: [...headRuns, ...skipped.map((e) => e.run), picked.run, ...tail.map((e) => e.run)],
    index: head.length + skipped.length,
  });
}

/** Take one entry out. Removing the playing song leaves `index` on the song that takes its place. */
export function removeEntry(s: QueueSnapshot, i: number): QueueSnapshot {
  if (i < 0 || i >= s.queue.length) return s;
  const queue = s.queue.filter((_, n) => n !== i);
  const runs = s.runs.filter((_, n) => n !== i);
  const index = i < s.index ? s.index - 1 : Math.min(s.index, Math.max(0, queue.length - 1));
  return { queue, runs, index };
}

/**
 * Drag an upcoming row to another upcoming slot. The row joins the run of the
 * row it lands on: dropped among Next in queue it becomes a song you added,
 * dropped into the list it plays as part of the list.
 */
export function moveEntry(s: QueueSnapshot, from: number, to: number): QueueSnapshot {
  const last = s.queue.length - 1;
  if (from <= s.index || to <= s.index || from > last || to > last || from === to) return s;
  const queue = [...s.queue];
  const runs = [...s.runs];
  const joins = runs[to];
  const [song] = queue.splice(from, 1);
  runs.splice(from, 1);
  queue.splice(to, 0, song);
  runs.splice(to, 0, joins);
  return normalize({ queue, runs, index: s.index });
}

/** Spotify's "Clear queue": only Next in queue goes; the list and Autoplay stay. */
export function clearQueued(s: QueueSnapshot): QueueSnapshot {
  return withUpcoming(s, upcoming(s).filter((e) => e.run !== 'queued'));
}

/** Autoplay switched off (or repeat on): its songs leave what comes next. */
export function dropAutoplay(s: QueueSnapshot): QueueSnapshot {
  const next = upcoming(s);
  return next.some((e) => e.run === 'autoplay') ? withUpcoming(s, next.filter((e) => e.run !== 'autoplay')) : s;
}

/** Autoplay's songs go at the very end. */
export function appendAutoplay(s: QueueSnapshot, songs: readonly Song[]): QueueSnapshot {
  if (!songs.length) return s;
  return { queue: [...s.queue, ...songs], runs: [...s.runs, ...songs.map((): QueueRun => 'autoplay')], index: s.index };
}

/** Shuffle switched on: the list still to come is shuffled; Next in queue stays first, Autoplay last. */
export function shuffleOn(s: QueueSnapshot, rand: () => number = Math.random): QueueSnapshot {
  const next = upcoming(s);
  const list = next.filter((e) => e.run === 'context').map((e) => e.song);
  if (list.length < 2) return s;
  return withUpcoming(s, [
    ...next.filter((e) => e.run === 'queued'),
    ...shuffled(list, rand).map((song) => ({ song, run: 'context' as const })),
    ...next.filter((e) => e.run === 'autoplay'),
  ]);
}

/**
 * Shuffle switched off: the list's songs still to come go back to the order
 * the list has, carrying on from the last list song played (the songs after
 * it first, then any earlier ones not played yet). Songs the list never had
 * keep their place at the end of the run.
 */
export function shuffleOff(s: QueueSnapshot, order: readonly string[]): QueueSnapshot {
  const rank = new Map<string, number>();
  order.forEach((id, i) => {
    if (!rank.has(id)) rank.set(id, i);
  });
  let from = -1;
  for (let i = s.index; i >= 0; i -= 1) {
    const r = s.runs[i] === 'context' ? rank.get(s.queue[i]?.id) : undefined;
    if (r !== undefined) {
      from = r;
      break;
    }
  }
  const next = upcoming(s);
  const list = next.filter((e) => e.run === 'context');
  const known = list.filter((e) => rank.has(e.song.id)).sort((a, b) => rank.get(a.song.id)! - rank.get(b.song.id)!);
  const after = known.filter((e) => rank.get(e.song.id)! > from);
  const before = known.filter((e) => rank.get(e.song.id)! <= from);
  const unknown = list.filter((e) => !rank.has(e.song.id));
  return withUpcoming(s, [...next.filter((e) => e.run === 'queued'), ...after, ...before, ...unknown, ...next.filter((e) => e.run === 'autoplay')]);
}

/**
 * Repeat all, at the end of the list: the list goes on again from its top (in
 * a fresh order when shuffled, never starting with the song that just ended).
 */
export function repeatList(s: QueueSnapshot, list: readonly Song[], opts: { shuffle?: boolean; rand?: () => number } = {}): QueueSnapshot {
  if (!list.length) return s;
  let round = opts.shuffle ? shuffled(list, opts.rand ?? Math.random) : [...list];
  const ended = s.queue[s.index];
  if (opts.shuffle && round.length > 1 && ended && round[0].id === ended.id) round = [...round.slice(1), round[0]];
  const base = dropAutoplay(s);
  return { queue: [...base.queue, ...round], runs: [...base.runs, ...round.map((): QueueRun => 'context')], index: base.index };
}

/** Keep at most `keep` played entries behind the playing song (a long session never grows without end). */
export function trimPlayed(s: QueueSnapshot, keep: number): QueueSnapshot {
  const drop = s.index - keep;
  if (drop <= 0) return s;
  return { queue: s.queue.slice(drop), runs: s.runs.slice(drop), index: s.index - drop };
}

// ---------------------------------------------------------------------------
// "Playing from": what the listener pressed play on.
// ---------------------------------------------------------------------------

/** Where the songs came from, for "Playing from" and "Next from". */
export interface QueueContext {
  kind: 'album' | 'playlist' | 'artist' | 'liked' | 'search' | 'radio' | 'home' | 'history' | 'page';
  label: string;
  path?: string;
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
