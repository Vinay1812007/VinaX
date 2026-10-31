import type { Song } from '@/types';
import type { Anchor } from './anchor';
import { languageOf, leadOf, type Source } from './rules';

/**
 * V2 — where Up Next looks. Every source starts from something the listener
 * chose: the session's anchor songs, their liked songs, the artists of their
 * liked songs. Nothing is seeded from an automatic pick, so the queue cannot
 * walk away from the session one hop at a time.
 *
 * Each call rotates through the seeds, so consecutive refills look in
 * different places instead of asking the catalogue the same question again.
 */

export interface CatalogueApi {
  similar(id: string, limit: number, signal?: AbortSignal): Promise<Song[]>;
  artistTop(id: string): Promise<Song[]>;
  search?(query: string, limit: number, signal?: AbortSignal): Promise<Song[]>;
  /** V2 1.4 — the personal engine's list around a seed; `personalOn` says whether to ask at all. */
  personal?(seedId: string, limit: number, signal?: AbortSignal): Promise<Song[]>;
  personalOn?(): boolean;
}

export interface Fetched {
  songs: Song[];
  source: Source;
  via: string;
}

export interface Lookup {
  label: string;
  source: Source;
  run(): Promise<Song[]>;
}

export interface SourcePlanInput {
  anchor: Anchor;
  favorites: readonly Song[];
  /** Lead artists this sitting pulled towards (likes, adds), strongest first. */
  pulledArtists: ReadonlyArray<{ id: string; name: string }>;
  rotation: number;
  tuneQuery?: string | null;
  api: CatalogueApi;
  signal?: AbortSignal;
}

const inLanguages = (song: Song, languages: readonly string[]): boolean => {
  if (!languages.length) return true;
  const l = languageOf(song);
  return !l || languages.includes(l);
};

/** Pick `n` items from a list starting at a rotating offset. */
export function rotate<T>(list: readonly T[], n: number, offset: number): T[] {
  if (!list.length) return [];
  const out: T[] = [];
  for (let i = 0; i < Math.min(n, list.length); i += 1) out.push(list[(offset + i) % list.length]);
  return out;
}

/** The artists behind the listener's liked songs in the session's languages, most-liked first. */
export function likedArtists(favorites: readonly Song[], languages: readonly string[]): Array<{ id: string; name: string; count: number }> {
  const byLead = new Map<string, { id: string; name: string; count: number }>();
  for (const s of favorites) {
    if (!inLanguages(s, languages)) continue;
    const a = s.artists?.[0];
    if (!a?.id || !a.name) continue;
    const k = leadOf(s);
    const row = byLead.get(k) ?? { id: a.id, name: a.name, count: 0 };
    row.count += 1;
    byLead.set(k, row);
  }
  return [...byLead.values()].sort((a, b) => b.count - a.count);
}

/**
 * The lookups for one refill: up to three anchor songs (the latest like or
 * add first, then the start seeds in rotation), two liked songs and two
 * liked artists in the session's languages, any artist this sitting pulled
 * towards, and the tune's search when one is active.
 */
export function planLookups(i: SourcePlanInput): Lookup[] {
  const { anchor, api, signal, rotation } = i;
  const out: Lookup[] = [];
  const latest = [...anchor.seeds].reverse().find((s) => s.via !== 'start');
  const starts = anchor.seeds.filter((s) => s.via === 'start');
  const anchorSongs = [...(latest ? [latest.song] : []), ...rotate(starts, latest ? 2 : 3, rotation * 3).map((s) => s.song)];
  for (const s of anchorSongs) out.push({ label: s.title, source: 'anchor', run: () => api.similar(s.id, 20, signal) });
  const likedHere = i.favorites.filter((s) => inLanguages(s, anchor.languages)).slice(0, 60);
  for (const s of rotate(likedHere, 2, rotation * 2)) out.push({ label: s.title, source: 'liked-similar', run: () => api.similar(s.id, 15, signal) });
  const artists = likedArtists(i.favorites, anchor.languages).slice(0, 12);
  const pulled = i.pulledArtists.slice(0, 1);
  const pulledIds = new Set(pulled.map((a) => a.id));
  for (const a of [...pulled, ...rotate(artists.filter((a) => !pulledIds.has(a.id)), 2, rotation * 2)]) out.push({ label: a.name, source: 'liked-artist', run: () => api.artistTop(a.id) });
  if (i.tuneQuery && api.search) {
    const q = i.tuneQuery;
    const search = api.search;
    out.push({ label: q, source: 'tune', run: () => search(q, 25, signal) });
  }
  // The personal engine, around the newest anchor: one lookup, first in the list so it is never the one the deadline cuts.
  const seed = anchorSongs[0];
  if (seed && api.personal && api.personalOn?.()) {
    const personal = api.personal;
    out.unshift({ label: 'Personal engine', source: 'personal', run: () => personal(seed.id, 20, signal) });
  }
  return out;
}

/**
 * Run the lookups in parallel; settle with whatever has answered by the
 * deadline. A slow or failing lookup never holds the rest back, and a late
 * answer still reaches `onLate` (the warm pool keeps it for the next refill).
 */
export async function runLookups(lookups: readonly Lookup[], deadlineMs: number, signal?: AbortSignal, onLate?: (f: Fetched) => void): Promise<Fetched[]> {
  let settled = false;
  const results: Fetched[] = [];
  if (!lookups.length) return results;
  await new Promise<void>((resolve) => {
    let pending = lookups.length;
    const timer = setTimeout(resolve, Math.max(0, deadlineMs));
    const finish = (): void => {
      pending -= 1;
      if (pending <= 0) {
        clearTimeout(timer);
        resolve();
      }
    };
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
    for (const l of lookups) {
      l.run().then(
        (songs) => {
          if (Array.isArray(songs)) {
            const f = { songs, source: l.source, via: l.label };
            if (settled) onLate?.(f);
            else results.push(f);
          }
          finish();
        },
        finish,
      );
    }
  });
  settled = true;
  return [...results];
}
