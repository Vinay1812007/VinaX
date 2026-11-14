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
 * Resolve picks to catalogue songs, in the picks' order. Searches run a few at
 * a time; a failed or empty search drops that pick. The same song found
 * twice is kept once.
 */
export async function resolvePicks<T extends SongPick>(picks: readonly T[], o: ResolveOptions = {}): Promise<Array<{ song: Song; pick: T }>> {
  const search = o.search ?? ((q: string, limit: number, signal?: AbortSignal) => searchSongs(q, limit, { signal }));
  const found: Array<{ song: Song; pick: T } | null> = new Array(picks.length).fill(null);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < picks.length && !o.signal?.aborted) {
      const i = next++;
      const pick = picks[i];
      try {
        const results = await search(`${pick.title} ${pick.artist}`, 6, o.signal);
        const song = bestMatch(results, pick);
        if (song) found[i] = { song, pick };
      } catch {
        /* this one is dropped */
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(o.concurrency ?? 4, picks.length)) }, worker));
  const seen = new Set<string>();
  return found.filter((x): x is { song: Song; pick: T } => {
    if (!x || seen.has(x.song.id)) return false;
    seen.add(x.song.id);
    return true;
  });
}
