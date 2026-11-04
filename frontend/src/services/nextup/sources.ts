import type { Song } from '@/types';
import type { Anchor } from './anchor';
import type { RecommendationContext } from '@/services/recommendation/types';
import type { TuneIntent } from '@/services/recommendation/tune';
import { languageOf, leadOf, type Source } from './rules';
import { trendingSeed } from '@/constants/seeds';
import { buildSongProfile } from '@/services/recommendation/profiles';

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
  /** 1.4 — one page of a search (Never repeat's widened sources). */
  searchPage?(query: string, page: number, limit: number, signal?: AbortSignal): Promise<Song[]>;
  /** 1.4 — artists the catalogue lists as similar to this one. */
  related?(artistId: string): Promise<Array<{ id: string; name: string }>>;
  /** 1.4 — one page of an artist's songs, most popular first (page 0 = `artistTop`). */
  artistPage?(artistId: string, page: number): Promise<Song[]>;
  /** The AI DJ's suggestions for the playing song, resolved to catalogue songs (services/ai/dj.ts). */
  aiDj?(seed: Song, ctx: RecommendationContext, o: { tune: TuneIntent | null; language: string | null }): Promise<Song[]>;
}

/** The AI DJ's songs for this refill (services/ai/dj.ts); absent when it is off. */
export type AiDjLookup = () => Promise<Song[]>;

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
  aiDj?: AiDjLookup;
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
  // The AI DJ: one ask per playing song and tune (it reuses its answer); a late answer still lands in the pool.
  if (i.aiDj) out.push({ label: 'AI DJ', source: 'ai-dj', run: i.aiDj });
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

/** 1.4 — pages each widened Never repeat lookup reads. */
export const WIDE_PAGES = 3;
const MOOD_WORD: Record<string, string> = { romantic: 'romantic', energetic: 'party', chill: 'chill', melancholy: 'sad', devotional: 'devotional' };

export interface WidePlanInput {
  anchor: Anchor;
  /** The session's languages, then the listener's own, most important first. */
  languages: readonly string[];
  /** 1 = related artists and deeper genre pages; 2 adds the explore source in those languages. */
  tier: 1 | 2;
  rotation: number;
  api: CatalogueApi;
  signal?: AbortSignal;
}

/**
 * 1.4 — Never repeat's widened lookups, for when the usual sources hold no
 * song the listener has not heard. Tier 1 reaches further from the session's
 * own songs: artists related to the anchor songs' artists (two pages each)
 * and deeper pages of a search for the anchor's genre or mood. Tier 2 adds
 * popular songs in the listener's own languages, past the pages the other
 * sources read. Every lookup still starts from the session or the listener,
 * and every answer still passes every rule.
 */
export function planWideLookups(i: WidePlanInput): Lookup[] {
  const { anchor, api, signal, rotation } = i;
  const out: Lookup[] = [];
  const seeds = rotate(anchor.seeds, 2, rotation).map((s) => s.song);
  const language = i.languages[0] ?? null;
  for (const seed of seeds) {
    const lead = seed.artists?.[0];
    if (lead?.id && api.related) {
      const related = api.related;
      const page = api.artistPage ?? ((id: string, n: number) => (n === 0 ? api.artistTop(id) : Promise.resolve([] as Song[])));
      out.push({
        label: lead.name,
        source: 'related-artist',
        run: async () => {
          const artists = rotate((await related(lead.id)).filter((a) => a.id && a.id !== lead.id), 3, rotation);
          const songs: Song[] = [];
          for (const a of artists) {
            if (signal?.aborted) break;
            for (const n of [0, 1]) songs.push(...((await page(a.id, n).catch(() => [] as Song[])) ?? []));
          }
          return songs;
        },
      });
    }
    if (api.searchPage && language) {
      const p = buildSongProfile(seed);
      const word = p.genres[0] ?? (p.confidence.mood > 0 ? MOOD_WORD[p.mood] : undefined) ?? 'songs';
      const query = `${word} ${language} songs`.replace(/songs songs$/, 'songs');
      const searchPage = api.searchPage;
      for (let k = 0; k < WIDE_PAGES; k += 1) out.push({ label: query, source: 'genre', run: () => searchPage(query, 2 + k + (rotation % 2), 20, signal) });
    }
  }
  if (i.tier >= 2 && api.searchPage) {
    const searchPage = api.searchPage;
    for (const lang of i.languages.slice(0, 2)) {
      for (let k = 0; k < WIDE_PAGES; k += 1) {
        const q = trendingSeed(lang, rotation + k);
        out.push({ label: lang, source: 'explore', run: () => searchPage(q, 4 + k, 20, signal) });
      }
    }
  }
  return out;
}
