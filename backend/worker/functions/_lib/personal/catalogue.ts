/**
 * Catalogue lookups for the personal engine, through the Worker's own
 * catalogue handler called in-process (as _lib/trends/catalog.ts does).
 * Metadata only; nothing here touches audio. Every function answers an empty
 * list when the catalogue is down or does not know the id: a page is built
 * from what the engine already has, and the next page tries again.
 */
import { onRequestGet as catalogueGet } from '../../api/cat/[[path]]';
import { SONG_ID_RE, songFromCatalogue } from './songs';
import type { SongFacts } from './types';

const INTERNAL_ORIGIN = 'https://catalogue.internal';
const CATALOGUE_TIMEOUT_MS = 4_000;

interface CatalogueEnv { CATALOG_UPSTREAMS?: string; CATALOG_DIRECT_URL?: string }

async function call(env: CatalogueEnv, path: string[], query: Record<string, string>): Promise<unknown> {
  const url = new URL(`${INTERNAL_ORIGIN}/api/cat/${path.map(encodeURIComponent).join('/')}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const timer = new Promise<null>((resolve) => setTimeout(() => resolve(null), CATALOGUE_TIMEOUT_MS));
  try {
    const res = await Promise.race([catalogueGet({ request: new Request(url.toString()), params: { path }, env }), timer]);
    if (!res || !res.ok) return null;
    const body = (await res.json().catch(() => null)) as { success?: boolean; data?: unknown } | null;
    return body && body.success === true ? body.data : null;
  } catch {
    return null;
  }
}

const facts = (list: unknown): SongFacts[] => (Array.isArray(list) ? list.map(songFromCatalogue).filter((s): s is SongFacts => s !== null) : []);

/** The catalogue's own "similar songs" for one song. */
export async function catalogueSimilar(env: CatalogueEnv, id: string): Promise<SongFacts[]> {
  if (!SONG_ID_RE.test(id)) return [];
  return facts(await call(env, ['songs', id, 'suggestions'], {}));
}

/** An artist's top songs. */
export async function catalogueArtistTop(env: CatalogueEnv, artistId: string): Promise<SongFacts[]> {
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(artistId)) return [];
  const data = (await call(env, ['artists', artistId], {})) as { topSongs?: unknown } | null;
  return facts(data?.topSongs);
}

/** Song search, one page. */
export async function catalogueSearch(env: CatalogueEnv, query: string, limit = 20, page = 1): Promise<SongFacts[]> {
  const text = query.replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!text) return [];
  const data = (await call(env, ['search', 'songs'], { query: text, limit: String(Math.min(40, Math.max(1, limit))), ...(page > 1 ? { page: String(Math.min(5, page)) } : {}) })) as { results?: unknown } | null;
  return facts(data?.results);
}

/** Full facts for ids the engine does not know yet (one call per id, capped). */
export async function catalogueSongs(env: CatalogueEnv, ids: readonly string[], cap = 10): Promise<SongFacts[]> {
  const out: SongFacts[] = [];
  for (const id of ids.slice(0, cap)) {
    if (!SONG_ID_RE.test(id)) continue;
    const data = await call(env, ['songs', id], {});
    out.push(...facts(data));
  }
  return out;
}
