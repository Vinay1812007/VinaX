/**
 * 8.5.0 — server-side, catalogue-only recommendations.
 *
 * VinaX keeps listening history and the taste profile on the device, so the
 * server never personalises from stored data: it answers "what is like THIS
 * song" (or like these few songs the app names). Every track returned is a
 * song the catalogue itself listed — an id the catalogue served in this
 * request — so nothing can be invented, and nothing about the listener is
 * read or kept.
 *
 * Sources, in order: the catalogue's own similar-songs list for the seed,
 * then the seed's lead artist's songs (only songs the catalogue CREDITS to
 * that artist, never a text match). An artist cap keeps the list varied, and
 * alternate releases of the same song (a remix of the seed, the same title
 * on a compilation) are folded away.
 */
import { canonicalKey } from './identityCore';
import { catalogSongSuggestions, searchCatalogSongs } from './trends/catalog';
import type { CatalogCandidate } from './trends/matcher';

export const SONG_ID = /^[A-Za-z0-9_-]{2,40}$/;
export const MAX_LIMIT = 30;
export const DEFAULT_LIMIT = 20;
export const MAX_SEEDS = 5;

export type RecReason = 'similar' | 'same_artist';

export interface RecTrack {
  id: string;
  title: string;
  /** Lead artist as the catalogue credits it. */
  artist: string;
  artists: string[];
  album: string | null;
  language: string | null;
  year: number | null;
  durationSec: number | null;
  reason: RecReason;
  /** Plain words for the reason, built only from the seed's own catalogue fields. */
  reasonText: string;
  /** The seed song this track came from. */
  seedId: string;
}

export interface SeedSong {
  id: string;
  title: string;
  artist: string;
  language: string | null;
}

export function seedOf(c: CatalogCandidate): SeedSong {
  return { id: c.id, title: c.title, artist: c.primaryArtists[0] ?? '', language: c.language };
}

const lower = (s: string): string => s.trim().toLowerCase();
const keyOf = (c: Pick<CatalogCandidate, 'title' | 'primaryArtists'>): string => canonicalKey(c.title, c.primaryArtists[0] ?? '');
const titleKeyOf = (title: string): string => canonicalKey(title, '');

export interface SelectOptions {
  limit: number;
  /** Keep only these languages (lower-case); empty keeps every language. */
  languages?: string[];
  /** Song ids never to return (the seeds, songs the app already has queued). */
  excludeIds?: Set<string>;
  /** At most this many songs per lead artist. */
  artistCap?: number;
}

/**
 * Pure selection over candidates the catalogue returned. Exported for tests.
 * `pools` are tried in order; each candidate keeps the reason of its pool.
 */
export function selectTracks(
  seed: SeedSong,
  pools: Array<{ reason: RecReason; songs: CatalogCandidate[] }>,
  opts: SelectOptions,
  taken: { ids: Set<string>; keys: Set<string>; perArtist: Map<string, number> } = { ids: new Set(), keys: new Set(), perArtist: new Map() },
): RecTrack[] {
  const limit = Math.max(1, Math.min(MAX_LIMIT, opts.limit));
  const cap = opts.artistCap ?? Math.max(2, Math.ceil(limit / 5));
  const languages = new Set((opts.languages ?? []).map(lower).filter(Boolean));
  const seedTitle = titleKeyOf(seed.title);
  const out: RecTrack[] = [];
  for (const pool of pools) {
    for (const c of pool.songs) {
      if (out.length >= limit) return out;
      if (!SONG_ID.test(c.id) || c.id === seed.id || opts.excludeIds?.has(c.id) || taken.ids.has(c.id)) continue;
      const lead = c.primaryArtists[0] ?? '';
      if (!lead) continue;
      if (languages.size && (!c.language || !languages.has(lower(c.language)))) continue;
      // The seed again under another release, or a song already chosen under another id.
      if (titleKeyOf(c.title) === seedTitle && seedTitle) continue;
      const key = keyOf(c);
      if (taken.keys.has(key)) continue;
      const artistKey = lower(lead);
      const used = taken.perArtist.get(artistKey) ?? 0;
      if (used >= cap) continue;
      taken.ids.add(c.id);
      taken.keys.add(key);
      taken.perArtist.set(artistKey, used + 1);
      out.push({
        id: c.id,
        title: c.title,
        artist: lead,
        artists: c.primaryArtists.slice(0, 4),
        album: c.album,
        language: c.language,
        year: c.year,
        durationSec: c.durationSec ?? null,
        reason: pool.reason,
        reasonText: pool.reason === 'similar' ? `Similar to “${seed.title}”` : `More by ${seed.artist}`,
        seedId: seed.id,
      });
    }
  }
  return out;
}

/** Only songs the catalogue credits to `artist` as a primary artist. */
export function creditedTo(artist: string, songs: CatalogCandidate[]): CatalogCandidate[] {
  const a = lower(artist);
  if (!a) return [];
  return songs.filter((s) => s.primaryArtists.some((p) => lower(p) === a));
}

/** The two catalogue pools for one seed. `withArtist` false skips the artist search (multi-seed requests). */
export async function poolsFor(seed: SeedSong, withArtist: boolean): Promise<Array<{ reason: RecReason; songs: CatalogCandidate[] }>> {
  const [similar, byArtist] = await Promise.all([
    catalogSongSuggestions(seed.id),
    withArtist && seed.artist ? searchCatalogSongs(seed.artist, 20).then((list) => creditedTo(seed.artist, list)) : Promise.resolve([] as CatalogCandidate[]),
  ]);
  return [
    { reason: 'similar', songs: similar },
    { reason: 'same_artist', songs: byArtist },
  ];
}

/**
 * Several seeds: each seed's picks are taken in turn (round robin) so one
 * seed never fills the list, with one shared artist cap and duplicate guard.
 */
export function interleave(perSeed: RecTrack[][], limit: number): RecTrack[] {
  const out: RecTrack[] = [];
  const ids = new Set<string>();
  for (let i = 0; out.length < limit; i += 1) {
    let any = false;
    for (const list of perSeed) {
      if (i >= list.length) continue;
      any = true;
      const t = list[i];
      if (ids.has(t.id)) continue;
      ids.add(t.id);
      out.push(t);
      if (out.length >= limit) break;
    }
    if (!any) break;
  }
  return out;
}

/** Parse `limit` (1..30, default 20). */
export function parseLimit(raw: string | null): number | null {
  if (raw == null || raw === '') return DEFAULT_LIMIT;
  if (!/^\d{1,3}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= MAX_LIMIT ? n : null;
}

/** Parse a comma list of language names (letters only, at most 6). */
export function parseLanguages(raw: string | null): string[] | null {
  if (raw == null || raw.trim() === '') return [];
  const list = raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (list.length > 6 || list.some((l) => !/^[a-z]{2,20}$/.test(l))) return null;
  return [...new Set(list)];
}

/** Parse a comma list of song ids (validated, deduplicated, at most `max`). */
export function parseIds(raw: string | null, max: number): string[] | null {
  if (raw == null || raw.trim() === '') return [];
  const list = [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))];
  if (list.length > max || list.some((id) => !SONG_ID.test(id))) return null;
  return list;
}
