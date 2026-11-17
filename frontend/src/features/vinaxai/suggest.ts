import type { Song } from '@/types';
import { searchSongs } from '@/services/api/saavn';

/**
 * Songs VinaX AI NAMES in a playlist card (PlaylistCard.tsx) become real
 * catalogue tracks here: each title/artist pair is searched in VinaX's own catalogue,
 * and only a confident match is kept (the title matches and the artist is
 * among the song's artists). A pair with no such match is dropped, so the AI
 * can never put a wrong or made-up song in front of the listener.
 */

export interface SongRef {
  title: string;
  artist: string;
}

export interface SongPick extends SongRef {
  reason?: string | null;
}

/** Lower case, no bracketed parts ("(From …)"), letters and digits only. */
export function normTitle(t: string): string {
  return t.toLowerCase().replace(/[([{][^)\]}]*[)\]}]/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

const words = (t: string): string[] => normTitle(t).split(' ').filter(Boolean);

/** Share of the shorter title's words found in the other one. */
function titleOverlap(a: string, b: string): number {
  const wa = words(a);
  const wb = new Set(words(b));
  if (!wa.length || !wb.size) return 0;
  const short = wa.length <= wb.size ? wa : [...wb];
  const long = wa.length <= wb.size ? wb : new Set(wa);
  return short.filter((w) => long.has(w)).length / short.length;
}

function artistMatches(song: Song, artist: string): boolean {
  const want = normTitle(artist);
  if (!want) return false;
  const names = [...(song.artists ?? []).map((a) => a.name), ...(song.subtitle ?? '').split(/,|&|·|-/)].map(normTitle).filter(Boolean);
  const first = want.split(' ')[0];
  return names.some((n) => n === want || n.includes(want) || want.includes(n) || (first.length >= 3 && n.split(' ').includes(first)));
}

/** The best confident match for a pair among search results, or null. */
export function bestMatch(results: readonly Song[], ref: SongRef): Song | null {
  let best: { song: Song; score: number } | null = null;
  for (const song of results) {
    if (!song?.id || song.generated) continue;
    const t = normTitle(song.title) === normTitle(ref.title) ? 1 : titleOverlap(song.title, ref.title);
    if (t < 0.75 || !artistMatches(song, ref.artist)) continue;
    const score = t + (song.audio?.length ? 0.1 : 0);
    if (!best || score > best.score) best = { song, score };
  }
  return best?.song ?? null;
}

export interface ResolveOptions {
  signal?: AbortSignal;
  /** Searches running at once. */
  concurrency?: number;
  search?: (q: string, limit: number, signal?: AbortSignal) => Promise<Song[]>;
}

/**
 * One answer per pair: a song, `null` when the catalogue has no confident
 * match, `undefined` when the search failed or was stopped (asked again next time).
 */
export type Lookup = Song | null | undefined;

export interface SongResolver {
  /** The kept answer for a pair, or undefined while it is not known yet. */
  peek(ref: SongRef): Lookup;
  /**
   * Look the pairs up, answering kept pairs at once and sharing a search
   * already running for the same pair. Searches start in the order asked, and
   * at most `concurrency` (4) run at once across every call on this resolver,
   * so a second press while the first is still looking adds no searches.
   * `onResult` fires for each pair as it settles, in whatever order the
   * catalogue answers.
   */
  resolve(refs: readonly SongRef[], onResult?: (i: number, song: Lookup) => void): Promise<Lookup[]>;
}

/** Pairs kept per resolver before the oldest are forgotten. */
const KEEP_MAX = 500;
const refKey = (r: SongRef): string => `${normTitle(r.title)}\u0000${normTitle(r.artist)}`;

/**
 * 2.1 — a resolver that keeps its answers, so Play, then Save or Add to queue,
 * never searches the same pair twice. Failed searches are not kept.
 */
export function createSongResolver(o: ResolveOptions = {}): SongResolver {
  const search = o.search ?? ((q: string, limit: number, signal?: AbortSignal) => searchSongs(q, limit, { signal }));
  const kept = new Map<string, Song | null>();
  const running = new Map<string, Promise<Lookup>>();
  const keep = (k: string, song: Song | null): void => {
    kept.set(k, song);
    if (kept.size > KEEP_MAX) kept.delete(kept.keys().next().value as string);
  };
  // One limit for the whole resolver: a free slot goes to the oldest waiter.
  const limit = Math.max(1, o.concurrency ?? 4);
  let active = 0;
  const waiting: Array<() => void> = [];
  const acquire = (): Promise<void> => {
    if (active < limit) {
      active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((r) => waiting.push(r));
  };
  const release = (): void => {
    const next = waiting.shift();
    if (next) next(); // the slot passes straight on
    else active -= 1;
  };
  const one = (ref: SongRef): Promise<Lookup> => {
    const k = refKey(ref);
    if (kept.has(k)) return Promise.resolve(kept.get(k) ?? null);
    const already = running.get(k);
    if (already) return already;
    const p = acquire()
      .then(async (): Promise<Lookup> => {
        try {
          if (o.signal?.aborted) return undefined;
          const song = bestMatch(await search(`${ref.title} ${ref.artist}`, 6, o.signal), ref);
          keep(k, song);
          return song;
        } catch {
          return undefined; // asked again next time
        } finally {
          release();
        }
      })
      .finally(() => running.delete(k));
    running.set(k, p);
    return p;
  };
  return {
    peek: (ref) => {
      const k = refKey(ref);
      return kept.has(k) ? kept.get(k) ?? null : undefined;
    },
    resolve: (refs, onResult) =>
      Promise.all(
        refs.map((ref, i) =>
          one(ref).then((song) => {
            onResult?.(i, song);
            return song;
          }),
        ),
      ),
  };
}

/**
 * Hands songs out in list order while lookups settle in any order: `emit`
 * gets each run of songs as soon as every pair before it has settled. A pair
 * not found (or failed) is skipped, and a song found twice goes out once. Pure.
 */
export function orderedFeed(total: number, emit: (songs: Song[]) => void): (i: number, song: Lookup) => void {
  const settled = new Array<boolean>(total).fill(false);
  const slots = new Array<Lookup>(total).fill(undefined);
  const seen = new Set<string>();
  let next = 0;
  return (i, song) => {
    if (i < 0 || i >= total || settled[i]) return;
    settled[i] = true;
    slots[i] = song;
    const run: Song[] = [];
    while (next < total && settled[next]) {
      const s = slots[next++];
      if (s && !seen.has(s.id)) {
        seen.add(s.id);
        run.push(s);
      }
    }
    if (run.length) emit(run);
  };
}

/**
 * Resolve picks to catalogue songs, in the picks' order. Searches run a few at
 * a time; a failed or empty search drops that pick. The same song found
 * twice is kept once.
 */
export async function resolvePicks<T extends SongPick>(picks: readonly T[], o: ResolveOptions = {}): Promise<Array<{ song: Song; pick: T }>> {
  const found = await createSongResolver(o).resolve(picks);
  const seen = new Set<string>();
  const out: Array<{ song: Song; pick: T }> = [];
  picks.forEach((pick, i) => {
    const song = found[i];
    if (!song || seen.has(song.id)) return;
    seen.add(song.id);
    out.push({ song, pick });
  });
  return out;
}
