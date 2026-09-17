import { getAlbum, getSongSuggestions, searchSongsPage } from '@/services/api';
import { isJunkTrack } from './quality';
import { topArtists, topLanguages } from '@/services/personalization/profile';
import { trendingSeed } from '@/constants/seeds';
import { LANGUAGES } from '@/constants/languages';
import { kidModeOn } from '@/services/kidMode';
import type { Candidate, RecommendationContext } from './types';
import type { Song } from '@/types';
import { isSongBlocked, useLibraryStore } from '@/store/libraryStore';

const REDISCOVERY_AGE_MS = 14 * 86_400_000;

const effectiveMode = (ctx: RecommendationContext): 'familiar' | 'balanced' | 'discover' => ctx.discoveryMode ?? (ctx.explore ? 'discover' : 'balanced');

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

  // Seed-first pool for autoplay/radio/playlist continuation. Keeping this
  // ahead of broad shelves makes the next song feel connected immediately,
  // while the rest of the gatherer supplies discovery and fallback options.
  if (ctx.seedSong) {
    const seed = ctx.seedSong;
    tasks.push(
      safe(getSongSuggestions(seed.id, 30), []).then((songs) =>
        songs.map((song) => ({ song, source: 'related' as const, seedTitle: seed.title })),
      ),
    );
    const artist = seed.artists[0]?.name;
    if (artist) {
      tasks.push(
        safe(searchSongsPage(artist, 1, 20), []).then((songs) =>
          songs.map((song) => ({ song, source: 'favorite-artist' as const, seedTitle: artist })),
        ),
      );
    }
    if (seed.language && !ctx.mutedLanguages.includes(seed.language)) {
      tasks.push(
        safe(searchSongsPage(`${seed.language} ${seed.genre ?? ''}`.trim(), 1, 15), []).then((songs) =>
          songs.map((song) => ({ song, source: 'trending' as const, seedTitle: seed.language ?? undefined })),
        ),
      );
    }
  }

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

  // 4b. Package A4 — exploration budget (opt-in). Trending picks in languages
  // the listener has literally never played: not in the profile, not pinned,
  // never muted. Salt-rotated so different opens explore different corners.
  if (effectiveMode(ctx) === 'discover') {
    const heard = new Set(Object.keys(ctx.profile.languages));
    const unheard = LANGUAGES.map((l) => l.id).filter(
      (id) => !heard.has(id) && !ctx.pinnedLanguages.includes(id) && !ctx.mutedLanguages.includes(id),
    );
    for (const lang of rotate(unheard, ctx.salt, 2)) {
      tasks.push(
        safe(searchSongsPage(trendingSeed(lang, ctx.salt), 1 + (Math.abs(ctx.salt) % 3), 10), []).then((songs) =>
          songs.map((song) => ({ song, source: 'explore' as const })),
        ),
      );
    }
  }

  // 4c. v7.0.0 — Familiar mode: known ground is a candidate source of its own.
  // Favourites and songs the listener finished (salt-rotated, no fetch), in
  // the seed's language when there is a seed. The recent-play guard and the
  // hard filter still keep out anything heard in the last stretch.
  const familiar: Candidate[] = [];
  if (effectiveMode(ctx) === 'familiar') {
    const seedLanguage = ctx.seedSong?.language && ctx.seedSong.language !== 'unknown' ? ctx.seedSong.language : null;
    const fits = (song: Song): boolean => !seedLanguage || !song.language || song.language === seedLanguage;
    const finished = ctx.history.filter((e) => e.completed && fits(e.song)).map((e) => e.song);
    for (const song of [...rotate(ctx.favorites.filter(fits), ctx.salt, 12), ...rotate(finished, ctx.salt, 10)]) familiar.push({ song, source: 'history' });
  }

  // 5. Rediscovery: completed listens older than two weeks (no fetch needed).
  const cutoff = Date.now() - REDISCOVERY_AGE_MS;
  const rediscovery: Candidate[] = ctx.history
    .filter((e) => e.completed && e.ts < cutoff)
    .slice(0, 15)
    .map((e) => ({ song: e.song, source: 'rediscovery' as const }));

  const settled = await Promise.allSettled(tasks);
  const pool: Candidate[] = settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));

  // Package A3: filter out any candidate whose primary artist the listener
  // explicitly asked less of. `softMuted` is an optional field; a v1 profile
  // without it just returns undefined and the filter is a no-op.
  const now = Date.now();
  const muted = ctx.profile?.softMuted ?? {};
  const isMuted = (song: Candidate['song']): boolean => {
    const primary = song.artists[0];
    if (!primary) return false;
    const byId = primary.id ? muted[primary.id] : undefined;
    const byName = muted[primary.name.toLowerCase()];
    const entry = byId ?? byName;
    return !!(entry && entry.until > now);
  };

  return [...pool, ...familiar, ...rediscovery]
    .filter((c) => !isSongBlocked(c.song, useLibraryStore.getState()))
    .filter((c) => !isJunkTrack(c.song))
    .filter((c) => !isMuted(c.song))
    // C2 — kid mode: explicit-flagged songs never enter the candidate pool.
    .filter((c) => !(c.song.explicit && kidModeOn()));
}

export async function generateNextCandidates(seed: Song, ctx: RecommendationContext): Promise<Candidate[]> {
  return gatherCandidates({ ...ctx, seedSong: seed, surface: ctx.surface ?? 'next' });
}
