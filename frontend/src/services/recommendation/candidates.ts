import { getAlbum, getSongSuggestions, searchSongsPage } from '@/services/api';
import { isBlockedSong } from '@/services/content/blocklist';
import { isJunkTrack } from './quality';
import { topArtists, topLanguages } from '@/services/personalization/profile';
import { trendingSeed } from '@/constants/seeds';
import { LANGUAGES } from '@/constants/languages';
import { kidModeOn } from '@/services/kidMode';
import { mergeCandidates, type Candidate, type CandidateSource, type RecommendationContext } from './types';
import { softMutedArtist } from './profiles';
import type { Song } from '@/types';
import { isSongBlocked, useLibraryStore } from '@/store/libraryStore';

const REDISCOVERY_AGE_MS = 14 * 86_400_000;

/** 7.2.0 — at most this many catalogue requests in flight per gather. */
export const CANDIDATE_FETCH_CONCURRENCY = 6;
/** 7.2.0 — a provider response is reused for 3 minutes; at most 60 are kept (oldest dropped first). */
const CACHE_TTL_MS = 3 * 60_000;
const CACHE_CAP = 60;
/** Cold start, after the profile, pinned languages and liked songs have all come up empty. */
const DEFAULT_LANGUAGES = ['hindi', 'english', 'tamil', 'telugu'];

const effectiveMode = (ctx: RecommendationContext): 'familiar' | 'balanced' | 'discover' => ctx.discoveryMode ?? (ctx.explore ? 'discover' : 'balanced');

/** Take n items from a list starting at a salt-rotated offset (wraps around). */
function rotate<T>(arr: T[], salt: number, n: number): T[] {
  if (arr.length <= n) return arr;
  const start = Math.abs(salt) % arr.length;
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(arr[(start + i) % arr.length]);
  return out;
}

export interface GatherReport {
  /** Sources that answered (or failed) in time, as `source:detail`. */
  settled: string[];
  /** Sources the gather stopped waiting for; their requests were cancelled where the API allows it. */
  abandoned: string[];
  ms: number;
}

export interface GatherOptions {
  /** Cancels the gather: it resolves at once with what has settled. */
  signal?: AbortSignal;
  /** From here on, resolve as soon as the pool has `minPool` songs and every required source (the seed's suggestions, the intent search) has answered. Default 2 500. */
  softDeadlineMs?: number;
  /** Resolve with whatever has settled and cancel the rest. Default 8 000. */
  hardDeadlineMs?: number;
  /** A useful pool, in distinct songs (fetched plus local). Default 60. */
  minPool?: number;
  /** Clock for the response cache, soft mutes and the report. Default `Date.now`. */
  now?: () => number;
  onReport?: (r: GatherReport) => void;
}

interface Task {
  label: string;
  source: CandidateSource;
  seedTitle?: string;
  required: boolean;
  /** Endpoint + query + page: identical keys share one request (at the largest limit asked for). */
  key: string;
  limit: number;
  fetch: (limit: number, signal: AbortSignal) => Promise<Song[]>;
}

const cache = new Map<string, { at: number; limit: number; songs: Song[] }>();

/** Tests: forget every cached provider response. */
export function resetCandidateCache(): void {
  cache.clear();
}

async function cached(key: string, limit: number, fetch: (limit: number) => Promise<Song[]>, now: () => number): Promise<Song[]> {
  const hit = cache.get(key);
  if (hit && now() - hit.at < CACHE_TTL_MS && hit.limit >= limit) return hit.songs;
  const songs = await fetch(limit);
  if (songs.length) {
    cache.delete(key);
    cache.set(key, { at: now(), limit, songs });
    if (cache.size > CACHE_CAP) cache.delete(cache.keys().next().value!);
  }
  return songs;
}

/** Run the tasks under the concurrency bound and the deadlines; `undefined` = abandoned. */
function runTasks(tasks: Task[], local: number, o: GatherOptions, now: () => number): Promise<Array<Song[] | undefined>> {
  const started = now();
  const out: Array<Song[] | undefined> = tasks.map(() => undefined);
  const groups = new Map<string, number[]>();
  tasks.forEach((t, i) => groups.set(t.key, [...(groups.get(t.key) ?? []), i]));
  const queue = [...groups.values()];
  const ctl = new AbortController();
  const ids = new Set<string>();
  let settled = 0;
  let running = 0;
  let soft = false;
  let done = false;
  return new Promise((resolve) => {
    const finish = (): void => {
      if (done) return;
      done = true;
      clearTimeout(softTimer);
      clearTimeout(hardTimer);
      o.signal?.removeEventListener('abort', finish);
      ctl.abort();
      o.onReport?.({ settled: tasks.filter((_, i) => out[i]).map((t) => t.label), abandoned: tasks.filter((_, i) => !out[i]).map((t) => t.label), ms: now() - started });
      resolve(out);
    };
    const check = (): void => {
      if (settled === tasks.length || (soft && ids.size + local >= (o.minPool ?? 60) && tasks.every((t, i) => !t.required || out[i]))) finish();
    };
    const pump = (): void => {
      while (!done && running < CANDIDATE_FETCH_CONCURRENCY && queue.length) {
        const members = queue.shift()!;
        const task = tasks[members[0]];
        running += 1;
        cached(task.key, Math.max(...members.map((i) => tasks[i].limit)), (n) => task.fetch(n, ctl.signal), now)
          .catch(() => [] as Song[]) // a dead source shrinks the pool, nothing else
          .then((songs) => {
            running -= 1;
            if (done) return;
            for (const i of members) {
              out[i] = songs.slice(0, tasks[i].limit);
              settled += 1;
              for (const s of out[i]!) ids.add(s.id);
            }
            check();
            pump();
          });
      }
    };
    const softTimer = setTimeout(() => { soft = true; check(); }, o.softDeadlineMs ?? 2_500);
    const hardTimer = setTimeout(finish, o.hardDeadlineMs ?? 8_000);
    if (o.signal?.aborted) return finish();
    o.signal?.addEventListener('abort', finish, { once: true });
    pump();
    check();
  });
}

/**
 * Gathers a wide candidate pool from local signals + upstream hints:
 * suggestions for recent listens/favorites, top-artist catalogs, trending
 * seeds for the user's languages, and rediscovery picks from old history.
 * Every fetch is individually fault-tolerant — a dead provider just shrinks
 * the pool, never breaks the shelf.
 *
 * 7.2.0 — bounded work: at most CANDIDATE_FETCH_CONCURRENCY requests in
 * flight, one request for identical ones, responses reused for a few
 * minutes, and no waiting on slow optional sources once the pool is useful
 * (see `GatherOptions`). A song found by several sources arrives ONCE, with
 * all of them (`mergeCandidates`).
 */
export async function gatherCandidates(ctx: RecommendationContext, opts: GatherOptions = {}): Promise<Candidate[]> {
  const now = opts.now ?? Date.now;
  const salt = Math.abs(ctx.salt);
  const tasks: Task[] = [];
  const add = (source: CandidateSource, detail: string, req: Pick<Task, 'key' | 'limit' | 'fetch'>, seedTitle?: string, required = false): void => {
    tasks.push({ label: `${source}:${detail}`, source, seedTitle, required, ...req });
  };
  const suggest = (id: string, limit: number): Pick<Task, 'key' | 'limit' | 'fetch'> => ({ key: `s|${id}`, limit, fetch: (n, signal) => getSongSuggestions(id, n, { signal }) });
  const search = (query: string, page: number, limit: number): Pick<Task, 'key' | 'limit' | 'fetch'> => ({ key: `q|${query}|${page}`, limit, fetch: (n, signal) => searchSongsPage(query, page, n, { signal }) });

  // Seed-first pool for autoplay/radio/playlist continuation. Keeping this
  // ahead of broad shelves makes the next song feel connected immediately,
  // while the rest of the gatherer supplies discovery and fallback options.
  if (ctx.seedSong) {
    const seed = ctx.seedSong;
    add('related', 'seed', suggest(seed.id, 30), seed.title, true);
    const artist = seed.artists[0]?.name;
    if (artist) add('favorite-artist', 'seed', search(artist, 1, 20), artist);
    // v7.1.0 — the listener asked for something (a tune, a pinned mood): fetch songs
    // FOR that intent, in the queue's language, instead of only re-scoring the seed's pool.
    if (ctx.intentQuery) for (const page of [1, 2 + (salt % 2)]) add('intent', `p${page}`, search(ctx.intentQuery, page, 20), ctx.intentQuery, true);
    if (seed.language && !ctx.mutedLanguages.includes(seed.language)) add('trending', 'seed', search(`${seed.language} ${seed.genre ?? ''}`.trim(), 1, 15), seed.language);
  }

  // 1. Related to recent listens (strongest signal).
  const recentSongs = ctx.history.slice(0, 6);
  const uniqueRecent = recentSongs.filter((e, i) => recentSongs.findIndex((x) => x.song.id === e.song.id) === i).slice(0, 3);
  for (const { song } of uniqueRecent) add('related', song.title, suggest(song.id, 12), song.title);

  // 2. Related to favorites.
  for (const fav of rotate(ctx.favorites, ctx.salt, 3)) add('related', fav.title, suggest(fav.id, 10), fav.title);

  // 2b. Favorite-album catalogs: the rest of albums you favorite songs from.
  const albums = new Map<string, string | undefined>();
  for (const f of ctx.favorites) if (f.album?.id && albums.size < 2) albums.set(f.album.id, f.album.name);
  for (const [id, name] of albums) add('favorite-album', id, { key: `a|${id}`, limit: 500, fetch: (_n, signal) => getAlbum(id, { signal }).then((a) => a?.songs ?? []) }, name);

  // 3. Favorite-artist catalogs. 7.2.0 — cold start: with no artist in the
  // profile, the artists of songs the listener liked (the onboarding picks
  // land in favourites) seed these searches.
  let artists = topArtists(ctx.profile, 8).map((a) => a.affinity.name);
  if (!artists.length) artists = [...new Set(ctx.favorites.map((f) => f.artists?.[0]?.name).filter((n): n is string => !!n))];
  for (const name of rotate(artists, ctx.salt, 3)) add('favorite-artist', name, search(name, 1 + (salt % 3), 10), name);

  // 4. Trending in the user's languages (also the cold-start backbone).
  // 7.2.0 — with no language signal: pinned languages, then the languages of
  // liked songs, and only then the defaults (never a muted one).
  const langs = new Set<string>([...topLanguages(ctx.profile, 2).map((l) => l.id), ...ctx.pinnedLanguages.slice(0, 3)]);
  const fill = (list: Array<string | null | undefined>): void => {
    for (const l of list) if (langs.size < 2 && l && l !== 'unknown' && !ctx.mutedLanguages.includes(l)) langs.add(l);
  };
  if (!langs.size) fill(ctx.favorites.map((f) => f.language));
  if (!langs.size) fill(DEFAULT_LANGUAGES);
  for (const lang of langs) if (!ctx.mutedLanguages.includes(lang)) add('trending', lang, search(trendingSeed(lang, ctx.salt), 1 + (salt % 4), 15));

  // 4b. Package A4 — exploration budget (opt-in). Trending picks in languages
  // the listener has literally never played: not in the profile, not pinned,
  // never muted. Salt-rotated so different opens explore different corners.
  if (effectiveMode(ctx) === 'discover') {
    const heard = new Set(Object.keys(ctx.profile.languages));
    const unheard = LANGUAGES.map((l) => l.id).filter((id) => !heard.has(id) && !ctx.pinnedLanguages.includes(id) && !ctx.mutedLanguages.includes(id));
    for (const lang of rotate(unheard, ctx.salt, 2)) add('explore', lang, search(trendingSeed(lang, ctx.salt), 1 + (salt % 3), 10));
  }

  // 4c. v7.0.0 — Familiar mode: known ground is a candidate source of its own.
  // Favourites and songs the listener finished (salt-rotated, no fetch), in
  // the seed's language when there is a seed. The recent-play guard and the
  // hard filter still keep out anything heard in the last stretch.
  const local: Candidate[] = [];
  if (effectiveMode(ctx) === 'familiar') {
    const seedLanguage = ctx.seedSong?.language && ctx.seedSong.language !== 'unknown' ? ctx.seedSong.language : null;
    const fits = (song: Song): boolean => !seedLanguage || !song.language || song.language === seedLanguage;
    const finished = ctx.history.filter((e) => e.completed && fits(e.song)).map((e) => e.song);
    for (const song of [...rotate(ctx.favorites.filter(fits), ctx.salt, 12), ...rotate(finished, ctx.salt, 10)]) local.push({ song, source: 'history' });
  }

  // 5. Rediscovery: completed listens older than two weeks (no fetch needed).
  const cutoff = now() - REDISCOVERY_AGE_MS;
  for (const e of ctx.history.filter((h) => h.completed && h.ts < cutoff).slice(0, 15)) local.push({ song: e.song, source: 'rediscovery' });

  const results = await runTasks(tasks, new Set(local.map((c) => c.song.id)).size, opts, now);
  const pool: Candidate[] = [];
  // Task order, not arrival order: the pool is the same however the network raced.
  tasks.forEach((t, i) => { for (const song of results[i] ?? []) pool.push({ song, source: t.source, seedTitle: t.seedTitle }); });

  // The rules every later stage re-checks, applied at the source too: blocked
  // (hidden by the listener or on the server list), junk, a soft-muted artist
  // (Package A3) and, in kid mode (C2), explicit-flagged songs.
  const library = useLibraryStore.getState();
  const kid = kidModeOn();
  const t = now();
  return mergeCandidates([...pool, ...local]).filter(({ song }) =>
    !isSongBlocked(song, library) && !isBlockedSong(song) && !isJunkTrack(song) && !softMutedArtist(song, ctx.profile?.softMuted, t) && !(kid && song.explicit));
}

export async function generateNextCandidates(seed: Song, ctx: RecommendationContext, opts?: GatherOptions): Promise<Candidate[]> {
  return gatherCandidates({ ...ctx, seedSong: seed, surface: ctx.surface ?? 'next' }, opts);
}
