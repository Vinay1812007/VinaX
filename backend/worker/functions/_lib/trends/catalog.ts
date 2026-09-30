/**
 * Catalogue lookups for the matcher, through the Worker's own self-hosted
 * catalogue handler (functions/api/cat). The handler is called in-process
 * with a synthetic request — no HTTP round trip to this Worker — and only
 * the song search and song-detail routes are used. Metadata only: nothing
 * here resolves or touches audio.
 */
import { onRequestGet as catalogueGet } from '../../api/cat/[[path]]';
import { decodeEntities, type CatalogCandidate } from './matcher';

/* eslint-disable @typescript-eslint/no-explicit-any */

const INTERNAL_ORIGIN = 'https://catalogue.internal';

export class CatalogUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CatalogUnavailable';
  }
}

const names = (list: unknown): string[] =>
  Array.isArray(list) ? list.map((a: any) => decodeEntities(String(a?.name ?? '')).trim()).filter(Boolean) : [];

/** Map one raw catalogue song (the dialect `api/cat` serves) to a match candidate. */
export function toCandidate(raw: any): CatalogCandidate | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' || typeof raw.id === 'number' ? String(raw.id) : '';
  const title = decodeEntities(String(raw.title ?? raw.name ?? '')).trim();
  if (!id || !title) return null;
  const info = raw.more_info ?? {};
  const map = info.artistMap ?? {};
  let primary = names(map.primary_artists);
  if (!primary.length && typeof raw.primaryArtists === 'string') primary = raw.primaryArtists.split(',').map((s: string) => decodeEntities(s).trim()).filter(Boolean);
  const featured = names(map.featured_artists);
  const credits = [...names(map.artists), ...String(info.music ?? '').split(',').map((s) => decodeEntities(s).trim()).filter(Boolean)];
  const album = typeof info.album === 'string' ? decodeEntities(info.album) : typeof raw.album === 'string' ? decodeEntities(raw.album) : typeof raw.album?.name === 'string' ? decodeEntities(raw.album.name) : null;
  const year = Number.parseInt(String(raw.year ?? ''), 10);
  const duration = Number.parseInt(String(info.duration ?? raw.duration ?? ''), 10);
  return {
    id,
    title,
    primaryArtists: primary,
    featuredArtists: featured,
    credits,
    album: album || null,
    language: typeof raw.language === 'string' && raw.language ? raw.language.toLowerCase() : null,
    year: Number.isFinite(year) ? year : null,
    durationSec: Number.isFinite(duration) && duration > 0 ? duration : null,
  };
}

async function callCatalogue(path: string[], query: Record<string, string>): Promise<any> {
  const url = new URL(`${INTERNAL_ORIGIN}/api/cat/${path.map(encodeURIComponent).join('/')}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const res = await catalogueGet({ request: new Request(url.toString()), params: { path } });
  if (res.status === 404) return null;
  if (!res.ok) throw new CatalogUnavailable(`catalogue answered ${res.status}`);
  const body = (await res.json().catch(() => null)) as { success?: boolean; data?: unknown } | null;
  if (!body || body.success !== true) throw new CatalogUnavailable('catalogue answered without data');
  return body.data;
}

/** Song search. Throws CatalogUnavailable when the catalogue is down (the caller retries on a later run). */
export async function searchCatalogSongs(query: string, limit = 10): Promise<CatalogCandidate[]> {
  const data = await callCatalogue(['search', 'songs'], { query, limit: String(Math.min(20, Math.max(1, limit))) });
  const results = Array.isArray(data?.results) ? data.results : [];
  return results.map(toCandidate).filter((c: CatalogCandidate | null): c is CatalogCandidate => c !== null);
}

/** One song by catalogue id; null when the catalogue does not know it. */
export async function lookupCatalogSong(id: string): Promise<CatalogCandidate | null> {
  if (!/^[A-Za-z0-9_-]{2,40}$/.test(id)) return null;
  const data = await callCatalogue(['songs', id], {});
  const list = Array.isArray(data) ? data : [];
  return list.length ? toCandidate(list[0]) : null;
}

/**
 * 8.5.0 — the catalogue's own "similar songs" for one song id (the list the
 * song page's Similar tracks shows). Empty when the catalogue has none or
 * does not know the id; throws CatalogUnavailable when it is down.
 */
export async function catalogSongSuggestions(id: string): Promise<CatalogCandidate[]> {
  if (!/^[A-Za-z0-9_-]{2,40}$/.test(id)) return [];
  const data = await callCatalogue(['songs', id, 'suggestions'], {});
  const list = Array.isArray(data) ? data : [];
  return list.map(toCandidate).filter((c: CatalogCandidate | null): c is CatalogCandidate => c !== null);
}
