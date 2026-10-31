/**
 * Candidate gathering: a pool of a few hundred songs from the six sources in
 * docs/personalisation.md, each tagged with where it came from. Catalogue
 * answers are written to personal_songs on the way through, so they are
 * embedded for next time. Every source is optional: one that fails leaves a
 * smaller pool, never an error.
 */
import type { DbEnv } from '../db';
import { db } from '../db';
import { catalogueArtistTop, catalogueSearch, catalogueSimilar } from './catalogue';
import { fetchSongs, touchSongs } from './songs';
import { tasteLanguages, tasteSongs, topArtists } from './taste';
import type { Candidate, CandidateSource, SongFacts, SongRow, Taste } from './types';

const DAY_MS = 86_400_000;

type CatalogueEnv = DbEnv & { CATALOG_UPSTREAMS?: string; CATALOG_DIRECT_URL?: string };

export interface Pool {
  candidates: Map<string, Candidate>;
  songs: Map<string, SongRow>;
  /** Songs the catalogue handed over that are not yet embedded in this model (to embed). */
  fresh: SongFacts[];
}

export interface GatherOptions {
  accountId: string;
  taste: Taste;
  embedModel: string;
  /** Rank around this song instead of the model. */
  seed?: string | null;
  /** Catalogue search phrases (the playlist builder's plan). */
  queries?: string[];
  /** Only these languages, when set. */
  languages?: string[] | null;
  /** Favour the model's own songs (rediscovery) or not at all. */
  own?: boolean;
  now?: number;
}

function add(pool: Map<string, Candidate>, id: string, source: CandidateSource, extra: Partial<Candidate> = {}): void {
  const c = pool.get(id) ?? { id, sources: new Set<CandidateSource>() };
  c.sources.add(source);
  if (typeof extra.similarity === 'number') c.similarity = Math.max(c.similarity ?? -1, extra.similarity);
  if (typeof extra.colisten === 'number') c.colisten = (c.colisten ?? 0) + extra.colisten;
  if (typeof extra.rank === 'number') c.rank = Math.min(c.rank ?? 99, extra.rank);
  if (typeof extra.trendPlays === 'number') c.trendPlays = extra.trendPlays;
  if (extra.seedId && !c.seedId) c.seedId = extra.seedId;
  pool.set(id, c);
}

interface Neighbour { id: string; similarity: number }
interface Partner { id: string; weight: number }
interface Trend { id: string; plays: number }

/** The community's trending list is the same for everyone with these languages: memoised per isolate for five minutes. */
const TREND_MEMO_MS = 5 * 60_000;
const trendMemo = new Map<string, { at: number; value: Trend[] }>();

async function trending(env: DbEnv, languages: string[] | null, now: number): Promise<Trend[]> {
  const key = (languages ?? ['*']).slice().sort().join(',');
  const hit = trendMemo.get(key);
  if (hit && now - hit.at < TREND_MEMO_MS) return hit.value;
  const r = await db.rpc<Trend[]>(env, 'personal_trending', { p_languages: languages, p_days: 7, p_limit: 60 });
  const value = r.ok && Array.isArray(r.value) ? r.value : [];
  if (r.ok) trendMemo.set(key, { at: now, value });
  return value;
}

/** For tests. */
export function _resetTrendMemo(): void {
  trendMemo.clear();
}

export async function gatherPool(env: CatalogueEnv, o: GatherOptions): Promise<Pool> {
  const now = o.now ?? Date.now();
  const { taste } = o;
  const pool = new Map<string, Candidate>();
  const facts: SongFacts[] = [];
  const languages = o.languages === undefined ? (tasteLanguages(taste, 3).length ? tasteLanguages(taste, 3) : null) : o.languages;
  const strongest = tasteSongs(taste, 12, now - 14 * DAY_MS).map(([id]) => id);
  const anchors = (strongest.length ? strongest : tasteSongs(taste, 12).map(([id]) => id)).slice(0, 10);
  const seeds = o.seed ? [o.seed] : anchors.slice(0, 3);

  const tasks: Array<Promise<void>> = [];

  // 1. neighbours of the taste vector (or of the seed)
  if (o.seed) {
    tasks.push(db.rpc<Neighbour[]>(env, 'personal_similar_songs', { p_song: o.seed, p_model: o.embedModel, p_limit: 60 }).then((r) => {
      if (r.ok && Array.isArray(r.value)) for (const n of r.value) add(pool, n.id, 'neighbours', { similarity: n.similarity, seedId: o.seed! });
    }));
  } else {
    tasks.push(db.rpc<Neighbour[]>(env, 'personal_neighbours', { p_account: o.accountId, p_model: o.embedModel, p_limit: 150, p_languages: languages, p_cooling: true }).then((r) => {
      if (r.ok && Array.isArray(r.value)) for (const n of r.value) add(pool, n.id, 'neighbours', { similarity: n.similarity });
    }));
  }

  // 2. the catalogue's similar lists (and the embedding neighbours) of the seeds
  for (const seed of seeds) {
    tasks.push(catalogueSimilar(env, seed).then((list) => {
      list.forEach((s, i) => { if (s.id !== seed) { facts.push(s); add(pool, s.id, 'similar', { rank: i, seedId: seed }); } });
    }));
    if (!o.seed) {
      tasks.push(db.rpc<Neighbour[]>(env, 'personal_similar_songs', { p_song: seed, p_model: o.embedModel, p_limit: 20 }).then((r) => {
        if (r.ok && Array.isArray(r.value)) for (const n of r.value) add(pool, n.id, 'similar', { similarity: n.similarity, seedId: seed });
      }));
    }
  }

  // 3. top artists' songs the account has not heard
  const artistIds = o.seed ? [] : topArtists(taste, 6).map(([key]) => key).filter((k) => !k.startsWith('name:')).slice(0, 3);
  for (const artistId of artistIds) {
    tasks.push(catalogueArtistTop(env, artistId).then((list) => {
      list.forEach((s, i) => { if (!taste.songs[s.id]) { facts.push(s); add(pool, s.id, 'artist', { rank: i }); } });
    }));
  }

  // 4. co-listening partners
  const coSeeds = o.seed ? [o.seed] : anchors;
  if (coSeeds.length) {
    tasks.push(db.rpc<Partner[]>(env, 'personal_colisten_for', { p_songs: coSeeds, p_limit: 100 }).then((r) => {
      if (r.ok && Array.isArray(r.value)) for (const p of r.value) add(pool, p.id, 'colisten', { colisten: p.weight });
    }));
  }

  // 5. what the community plays in these languages
  if (!o.seed) {
    tasks.push(trending(env, languages, now).then((list) => {
      list.forEach((t, i) => add(pool, t.id, 'trending', { rank: i, trendPlays: t.plays }));
    }));
  }

  // 6. the account's own songs: rediscoveries and likes
  if (o.own !== false && !o.seed) {
    for (const [id, a] of tasteRediscoveries(taste, now)) add(pool, id, 'own', { rank: Math.round(60 - Math.min(60, a.score)) });
  }

  // 7. search phrases (the playlist builder)
  for (const query of (o.queries ?? []).slice(0, 6)) {
    tasks.push(catalogueSearch(env, query, 20).then((list) => {
      list.forEach((s, i) => { facts.push(s); add(pool, s.id, 'search', { rank: i }); });
    }));
  }

  await Promise.all(tasks);

  // What the catalogue brought is written first (verified: it came from the catalogue, not a
  // device), then the whole pool is read once; only verified rows come back.
  const catalogued = dedupe(facts);
  if (catalogued.length) await touchSongs(env, catalogued, true);
  const songs = await fetchSongs(env, [...pool.keys()]);
  const fresh = catalogued.filter((f) => songs.get(f.id)?.embed_model !== o.embedModel);
  for (const id of [...pool.keys()]) if (!songs.has(id)) pool.delete(id);
  return { candidates: pool, songs, fresh };
}

function tasteRediscoveries(taste: Taste, now: number): Array<[string, { score: number }]> {
  const out: Array<[string, { score: number }]> = [];
  for (const [id, a] of Object.entries(taste.songs)) {
    if (a.score <= 1) continue;
    if (a.likes > 0 || now - a.last > 21 * DAY_MS) out.push([id, a]);
  }
  return out.sort((x, y) => y[1].score - x[1].score).slice(0, 40);
}

function dedupe(list: SongFacts[]): SongFacts[] {
  const seen = new Set<string>();
  return list.filter((f) => (seen.has(f.id) ? false : (seen.add(f.id), true)));
}
