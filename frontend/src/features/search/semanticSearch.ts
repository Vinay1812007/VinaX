import type { ImageVariant, Playlist, SearchResults, Song } from '@/types';
import { searchPlaylists, searchSongs } from '@/services/api';
import { cosine } from '@/services/ai/embeddings';
import { localTextVector } from '@/services/ai/localVectors';
import { catalogQueries, parseMusicIntent } from '@/services/ai/musicIntent';
import { semanticRank } from '@/services/ai/semantic';
import { stripExplicit } from '@/services/kidMode';
import { isSongBlocked, useLibraryStore } from '@/store/libraryStore';
import { useHistoryStore } from '@/store/historyStore';
import { mergeReading, readSearchOnServer } from '@/services/ai/searchReading';
import { seedSongs } from './seedSearch';

/**
 * 8.2.0 — natural-language search ("sad telugu songs for rain").
 *
 * Candidates: the search's own results, the listener's liked and recently
 * played songs, and catalogue searches built from the request's language
 * and mood (the short phrasings the catalogue answers). They are ranked
 * against the query by services/ai/semantic.ts — server embeddings when the
 * engine answers, on-device vectors otherwise — and artists and playlists
 * are matched from the same read of the request. Loaded lazily, only for
 * queries that read like a description.
 */

export interface MatchedArtist {
  id: string;
  name: string;
  image: string | null;
  images?: ImageVariant[];
}

export interface SemanticMatches {
  songs: Song[];
  artists: MatchedArtist[];
  playlists: Playlist[];
  /** Where the song ranking came from: the server model, the device, or both. */
  space: 'model' | 'local' | 'mixed';
  /** 8.5.0 — the "songs like <name>" seed: what was asked, and what the catalogue matched it to (null: not found). */
  seed?: { asked: string; matched: { kind: 'song'; title: string; artist: string } | { kind: 'artist'; name: string } | null } | null;
}

export interface SemanticContext {
  results: SearchResults | null;
  pinned: readonly string[];
  muted: readonly string[];
  signal?: AbortSignal;
}

const SONGS_SHOWN = 12;
const LIBRARY_CAP = 200;

/** Liked songs, then recent plays (newest first), de-duplicated and capped. */
function librarySongs(): Song[] {
  const out: Song[] = [];
  const seen = new Set<string>();
  const push = (s: Song | undefined) => {
    if (s && s.id && !seen.has(s.id) && out.length < LIBRARY_CAP) {
      seen.add(s.id);
      out.push(s);
    }
  };
  try {
    for (const s of useLibraryStore.getState().favorites) push(s);
    // History is stored newest first.
    for (const e of useHistoryStore.getState().entries) {
      if (out.length >= LIBRARY_CAP) break;
      push(e?.song);
    }
  } catch {
    /* stores unavailable: search results alone */
  }
  return out;
}

const fetchSongs = (queries: string[], signal?: AbortSignal): Promise<Song[]> =>
  Promise.allSettled(queries.map((q) => searchSongs(q, 20, { signal }))).then((r) => r.flatMap((x) => (x.status === 'fulfilled' ? x.value : [])));

const inDecade = (s: Song, decade: number): boolean => {
  const y = Number(String(s.year ?? '').slice(0, 4));
  return Number.isFinite(y) && y >= decade && y < decade + 10;
};

export async function findSemanticMatches(query: string, ctx: SemanticContext): Promise<SemanticMatches> {
  const local = parseMusicIntent(query);
  const langs0 = local.languages.length ? local.languages : ctx.pinned.slice(0, 2);
  const queries = catalogQueries(local, langs0, 2);
  // 8.5.0 — the server's AI reading runs alongside the first catalogue fetch;
  // it can only add cues (a mood, a seed, a period) the word lists missed.
  const [catalogue, lists, reading] = await Promise.all([
    fetchSongs(queries, ctx.signal),
    queries[0] ? searchPlaylists(queries[0], 12, { signal: ctx.signal }).catch(() => [] as Playlist[]) : Promise.resolve([] as Playlist[]),
    readSearchOnServer(query, ctx.pinned, ctx.signal),
  ]);
  const intent = mergeReading(local, reading);
  const langs = intent.languages.length ? intent.languages : ctx.pinned.slice(0, 2);
  // What the reading added is fetched too (at most two more searches), plus the seed's similar songs.
  const extraQueries = intent === local ? [] : catalogQueries(intent, langs, 4).filter((q) => !queries.includes(q)).slice(0, 2);
  const [extra, seed] = await Promise.all([
    extraQueries.length ? fetchSongs(extraQueries, ctx.signal) : Promise.resolve([] as Song[]),
    intent.seed ? seedSongs(intent.seed.text, ctx.signal) : Promise.resolve(null),
  ]);
  const seeded = !!seed && seed.songs.length > 0;
  // A seed with nothing else asked ("songs like <name>"): the catalogue's similar songs ARE the answer.
  const seedOnly = seeded && intent.cues - 1 - intent.languages.length <= 0;

  const library = useLibraryStore.getState();
  const muted = new Set(ctx.muted);
  const candidates = seeded ? (seedOnly ? seed.songs : [...seed.songs, ...catalogue, ...extra]) : [...(ctx.results?.songs ?? []), ...librarySongs(), ...catalogue, ...extra];
  const seedKey = seed?.song ? seed.song.id : null;
  let pool = stripExplicit(candidates).filter(
    (s) => s.id !== seedKey && !(s.language && muted.has(s.language)) && !isSongBlocked(s, library),
  );
  // A named language is the request's strongest word: keep to it when it leaves enough.
  if (intent.languages.length) {
    const inLang = pool.filter((s) => s.language && intent.languages.includes(s.language));
    if (inLang.length >= 5) pool = inLang;
  }
  // 8.5.0 — a named decade is a filter, not only a nudge, whenever enough songs carry a year inside it.
  if (intent.decade != null) {
    const decade = intent.decade;
    const kept = pool.filter((s) => inDecade(s, decade));
    if (kept.length >= 5) pool = kept;
  }
  // The seed's own name is not what to rank against ("songs like X" would favour covers of X).
  const rankQuery = intent.seed ? query.replace(intent.seed.text, ' ').replace(/\s+/g, ' ').trim() : query;
  const ranked = seedOnly
    ? pool.map((song) => ({ song, score: 0, space: 'local' as const }))
    : await semanticRank(rankQuery || query, pool, { intent, leashMs: 4000, embedLimit: 128, signal: ctx.signal });
  const top = ranked.slice(0, SONGS_SHOWN);
  const spaces = new Set(top.map((x) => x.space));
  const space = spaces.size > 1 ? 'mixed' : spaces.has('model') ? 'model' : 'local';

  // Artists: credited on the best-fitting songs (rank-weighted), with the search's own artist cards for images.
  const known = new Map((ctx.results?.artists ?? []).map((a) => [a.id, a]));
  const weight = new Map<string, { artist: MatchedArtist; w: number }>();
  ranked.slice(0, 30).forEach((x, i) => {
    for (const a of (x.song.artists ?? []).slice(0, 2)) {
      if (!a.id || !a.name) continue;
      const card = known.get(a.id);
      const prev = weight.get(a.id);
      const w = (prev?.w ?? 0) + (30 - i);
      weight.set(a.id, { artist: prev?.artist ?? { id: a.id, name: a.name, image: a.image ?? null, images: card?.images }, w });
    }
  });
  const artists = [...weight.values()].sort((a, b) => b.w - a.w).slice(0, 8).map((x) => x.artist);

  // Playlists: the search's own and the catalogue's, by how their names read against the request.
  const q = localTextVector(query);
  const seenLists = new Set<string>();
  const playlists = [...(ctx.results?.playlists ?? []), ...lists]
    .filter((p) => p && p.id && !seenLists.has(p.id) && (seenLists.add(p.id), true))
    .filter((p) => !intent.languages.length || !p.language || intent.languages.includes(p.language))
    .map((p) => ({ p, score: cosine(q, localTextVector(`${p.title} ${p.subtitle ?? ''}`)) + (p.language && langs.includes(p.language) ? 0.1 : 0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((x) => x.p);

  const seedInfo = intent.seed
    ? {
        asked: intent.seed.text,
        matched: seed?.song ? { kind: 'song' as const, title: seed.song.title, artist: seed.song.artists[0]?.name ?? seed.song.subtitle } : seed?.artist ? { kind: 'artist' as const, name: seed.artist } : null,
      }
    : null;
  return { songs: top.map((x) => x.song), artists, playlists, space, seed: seedInfo };
}

/** 8.5.0 — one honest line: whose similar songs these are, or that the named song was not found. */
export function explainMatches(query: string, seed: SemanticMatches['seed']): string {
  if (!seed) return `Ranked by how well each song fits “${query}”.`;
  if (!seed.matched) return `“${seed.asked}” isn’t in the catalogue, so these match the rest of your words.`;
  return seed.matched.kind === 'song'
    ? `Songs like “${seed.matched.title}” by ${seed.matched.artist}, from the catalogue’s similar songs.`
    : `Songs like ${seed.matched.name}’s, from the catalogue’s similar songs.`;
}

