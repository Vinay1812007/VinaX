/**
 * Songs as the personal engine keeps them: the facts a device reports with
 * its events (checked field by field, never trusted), the same facts read
 * from a raw catalogue song, the row in personal_songs, and the record a
 * page carries. Upsert and fetch live here too.
 */
import { canonicalKey } from '../identityCore';
import { db, q, type DbEnv, type Value } from '../db';
import { asObject, clip } from '../edge';
import { SONG_COLUMNS, type ArtistRef, type SongFacets, type SongFacts, type SongRecord, type SongRow } from './types';

export const SONG_ID_RE = /^[A-Za-z0-9_-]{2,40}$/;
const ARTIST_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const MOOD_RE = /^[a-z][a-z -]{1,30}$/;

const str = (v: unknown, max: number): string | null => clip(v, max);
const idOf = (v: unknown, re: RegExp): string | null => (typeof v === 'string' && re.test(v) ? v : typeof v === 'number' && Number.isFinite(v) && re.test(String(v)) ? String(v) : null);

function intOf(v: unknown, min: number, max: number): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  const i = Math.round(n);
  return i < min || i > max ? null : i;
}

function cleanArtists(raw: unknown): ArtistRef[] {
  if (!Array.isArray(raw)) return [];
  const out: ArtistRef[] = [];
  for (const a of raw.slice(0, 6)) {
    const o = asObject(a);
    const name = str(o?.name, 120);
    if (!name) continue;
    out.push({ id: idOf(o?.id, ARTIST_ID_RE), name });
  }
  return out;
}

function cleanFacets(raw: unknown): SongFacets {
  const o = asObject(raw) ?? {};
  const out: SongFacets = {};
  for (const k of ['mood', 'genre', 'vibe'] as const) {
    const v = typeof o[k] === 'string' ? o[k].trim().toLowerCase() : '';
    if (MOOD_RE.test(v)) out[k] = v;
  }
  for (const k of ['energy', 'tempo'] as const) {
    const v = o[k];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= (k === 'tempo' ? 400 : 1)) out[k] = Math.round(v * 1000) / 1000;
  }
  return out;
}

/** The facts the device sent for one song, or null when it is not a song. */
export function cleanSongFacts(raw: unknown): SongFacts | null {
  const s = asObject(raw);
  if (!s) return null;
  const id = idOf(s.id, SONG_ID_RE);
  const title = str(s.title, 200);
  if (!id || !title) return null;
  const artists = cleanArtists(s.artists);
  const artist = str(s.artist, 120) ?? artists[0]?.name ?? null;
  if (!artist) return null;
  const artistId = idOf(s.artistId, ARTIST_ID_RE) ?? artists.find((a) => a.name === artist)?.id ?? artists[0]?.id ?? null;
  const language = str(s.language, 40)?.toLowerCase() ?? null;
  return {
    id, title, artist, artistId,
    artists: artists.length ? artists : [{ id: artistId, name: artist }],
    album: str(s.album, 200), albumId: idOf(s.albumId, ARTIST_ID_RE),
    language, year: intOf(s.year, 1900, 2100), duration: intOf(s.duration, 1, 36_000),
    image: typeof s.image === 'string' && /^https:\/\/[^\s"'<>]{8,512}$/.test(s.image) ? s.image : null,
    facets: cleanFacets(s.facets),
  };
}

const decodeEntities = (t: string): string => t.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#039;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/** The facts in one raw catalogue song (the dialect api/cat serves); null when it is not one. */
export function songFromCatalogue(raw: unknown): SongFacts | null {
  const s = asObject(raw);
  if (!s) return null;
  const info = asObject(s.more_info) ?? {};
  const map = asObject(info.artistMap) ?? {};
  const primary = cleanArtists(Array.isArray(map.primary_artists) ? map.primary_artists.map((a) => ({ ...(asObject(a) ?? {}), name: decodeEntities(String(asObject(a)?.name ?? '')) })) : []);
  const fallbackNames = typeof s.primaryArtists === 'string' ? s.primaryArtists.split(',').map((n) => decodeEntities(n).trim()).filter(Boolean).slice(0, 6) : [];
  const artists = primary.length ? primary : fallbackNames.map((name) => ({ id: null, name }));
  const image = typeof s.image === 'string' ? s.image.replace(/150x150|50x50/, '500x500') : Array.isArray(s.image) ? String((asObject(s.image[s.image.length - 1]) ?? {}).link ?? (asObject(s.image[s.image.length - 1]) ?? {}).url ?? '') : '';
  const albumRaw = typeof info.album === 'string' ? info.album : typeof s.album === 'string' ? s.album : asObject(s.album)?.name;
  return cleanSongFacts({
    id: s.id,
    title: decodeEntities(String(s.title ?? s.name ?? '')),
    artist: artists[0]?.name,
    artistId: artists[0]?.id,
    artists,
    album: typeof albumRaw === 'string' ? decodeEntities(albumRaw) : null,
    albumId: info.album_id ?? asObject(s.album)?.id ?? null,
    language: s.language,
    year: s.year,
    duration: info.duration ?? s.duration,
    image,
    facets: {},
  });
}

export const songKey = (f: Pick<SongFacts, 'title' | 'artist'>): string => canonicalKey(f.title, f.artist);

export function toFacts(row: SongRow): SongFacts {
  return {
    id: row.id, title: row.title, artist: row.artist, artistId: row.artist_id, artists: Array.isArray(row.artists) ? row.artists : [],
    album: row.album, albumId: row.album_id, language: row.language, year: row.year, duration: row.duration, image: row.image,
    facets: row.facets && typeof row.facets === 'object' ? row.facets : {},
  };
}

export const toRecord = (row: SongRow, reason?: string): SongRecord => ({ ...toFacts(row), ...(reason ? { reason } : {}) });

/**
 * Write songs the engine met, through `personal_touch_songs`: a new row is
 * inserted; a known row only gains what it lacked and a newer `last_seen`.
 * Facts from a device are never allowed to rewrite a row another listener
 * sees (`verified: false`, the row stays unverified until the catalogue
 * confirms it); facts from the catalogue (`verified: true`) replace a
 * device's version and verify the row. Answers how many rows were new.
 */
export async function touchSongs(env: DbEnv, songs: readonly SongFacts[], verified: boolean): Promise<Value<number>> {
  if (!songs.length) return { ok: true, value: 0 };
  const seen = new Set<string>();
  const rows = songs.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true))).map((s) => ({ ...s, key: songKey(s) }));
  return db.rpc<number>(env, 'personal_touch_songs', { p_rows: rows, p_verified: verified });
}

/**
 * Rows by id, in a map (ids the pool does not know are simply absent).
 * Verified rows only unless `all`: a page never carries a song no catalogue
 * lookup has confirmed.
 */
export async function fetchSongs(env: DbEnv, ids: readonly string[], o: { all?: boolean } = {}): Promise<Map<string, SongRow>> {
  const out = new Map<string, SongRow>();
  const unique = [...new Set(ids)].filter((id) => SONG_ID_RE.test(id));
  for (let i = 0; i < unique.length; i += 200) {
    const query = q().in('id', unique.slice(i, i + 200)).select(SONG_COLUMNS);
    if (!o.all) query.eq('verified', 'true');
    const r = await db.select<SongRow>(env, 'personal_songs', query);
    if (!r.ok) continue;
    for (const row of r.rows) out.set(row.id, row);
  }
  return out;
}
