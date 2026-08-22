import { getAlbum, getSongSuggestions, searchSongsPage } from '@/services/api';
import { isJunkTrack } from './quality';
import { topArtists, topLanguages } from '@/services/personalization/profile';
import { trendingSeed } from '@/constants/seeds';
import type { Candidate, RecommendationContext } from './types';

const REDISCOVERY_AGE_MS = 14 * 86_400_000;

/** Take n items from a list starting at a salt-rotated offset (wraps around). */
function rotate<T>(arr: T[], salt: number, n: number): T[] {
  if (arr.length <= n) return arr;
  const start = Math.abs(salt) % arr.length;
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(arr[(start + i) % arr.length]);
  return out;
}

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

/**
 * Gathers a wide candidate pool from local signals + upstream hints:
 * suggestions for recent listens/favorites, top-artist catalogs, trending
 * seeds for the user's languages, and rediscovery picks from old history.
 * Every fetch is individually fault-tolerant — a dead provider just shrinks
 * the pool, never breaks the shelf.
 */
export async function gatherCandidates(ctx: RecommendationContext): Promise<Candidate[]> {
  const tasks: Array<Promise<Candidate[]>> = [];

  // 1. Related to recent listens (strongest signal).
  const recentSongs = ctx.history.slice(0, 6);
  const uniqueRecent = recentSongs.filter(
    (e, i) => recentSongs.findIndex((x) => x.song.id === e.song.id) === i,
  ).slice(0, 3);
  for (const entry of uniqueRecent) {
    tasks.push(
      safe(getSongSuggestions(entry.song.id, 12), []).then((songs) =>
        songs.map((song) => ({ song, source: 'related' as const, seedTitle: entry.song.title })),
      ),
    );
  }

  // 2. Related to favorites.
  for (const fav of rotate(ctx.favorites, ctx.salt, 3)) {
    tasks.push(
      safe(getSongSuggestions(fav.id, 10), []).then((songs) =>
        songs.map((song) => ({ song, source: 'related' as const, seedTitle: fav.title })),
      ),
    );
  }

  // 2b. Favorite-album catalogs: the rest of albums you favorite songs from.
  const favAlbumIds = [...new Set(
    ctx.favorites.map((f) => f.album?.id).filter((id): id is string => !!id),
  )].slice(0, 2);
  for (const albumId of favAlbumIds) {
    tasks.push(
      safe(getAlbum(albumId), null).then((album) =>
        (album?.songs ?? []).map((song) => ({ song, source: 'favorite-album' as const, seedTitle: album?.title })),
      ),
    );
  }

  // 3. Favorite-artist catalogs.
  for (const { affinity } of rotate(topArtists(ctx.profile, 8), ctx.salt, 3)) {
    tasks.push(
      safe(searchSongsPage(affinity.name, 1 + (Math.abs(ctx.salt) % 3), 10), []).then((songs) =>
        songs.map((song) => ({ song, source: 'favorite-artist' as const, seedTitle: affinity.name })),
      ),
    );
  }

  // 4. Trending in the user's languages (also the cold-start backbone).
  const langs = new Set<string>([
    ...topLanguages(ctx.profile, 2).map((l) => l.id),
    ...ctx.pinnedLanguages.slice(0, 3),
  ]);
  if (langs.size === 0) langs.add('hindi').add('english');
  for (const lang of langs) {
    if (ctx.mutedLanguages.includes(lang)) continue;
    tasks.push(
      safe(searchSongsPage(trendingSeed(lang, ctx.salt), 1 + (Math.abs(ctx.salt) % 4), 15), []).then((songs) =>
        songs.map((song) => ({ song, source: 'trending' as const })),
      ),
    );
  }

  // 5. Rediscovery: completed listens older than two weeks (no fetch needed).
  const cutoff = Date.now() - REDISCOVERY_AGE_MS;
  const rediscovery: Candidate[] = ctx.history
    .filter((e) => e.completed && e.ts < cutoff)
    .slice(0, 15)
    .map((e) => ({ song: e.song, source: 'rediscovery' as const }));

  const settled = await Promise.allSettled(tasks);
  const pool: Candidate[] = settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  return [...pool, ...rediscovery].filter((c) => !isJunkTrack(c.song));
}
