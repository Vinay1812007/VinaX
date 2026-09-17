import type { Song } from '@/types';
import type { RecommendationContext } from '@/services/recommendation/types';
import { rankCandidates } from '@/services/recommendation/scoring';
import { rejectReasonFor } from '@/services/recommendation/filters';
import { dedupeByIdentity } from '@/services/recommendation/songIdentity';
import { topArtists, topLanguages } from '@/services/personalization/profile';
import { aiRerankSongs } from './recommendations';

/**
 * v7.0.1 — "Trending for you": what is trending in the catalogue, ordered for
 * THIS listener.
 *
 * The pool is real trending search results, nothing else. It passes the same
 * hard rules as a queue (mutes, blocks, explicit, junk, one cut per song),
 * then the on-device scorer orders it by taste — that order is always
 * available. When AI is allowed, the ranking engine may re-order the top of
 * that list inside a short budget; it answers with ids from the list it was
 * given (anything else is discarded by `aiRerankSongs`), so it can change the
 * order and never the contents. Slow, down or unconfigured → the on-device
 * order ships and the shelf says so.
 */
export interface TrendingCuration {
  songs: Song[];
  /** Who chose the final order. */
  by: 'ai' | 'local';
}

export interface CurateTrendingOptions {
  allowAi: boolean;
  limit?: number;
  /** How long the shelf may wait for the AI order before shipping the on-device one. */
  budgetMs?: number;
  blocked?: (song: Song) => boolean;
  hideExplicit?: boolean;
}

/** Compact, privacy-bounded brief: languages, artist names and recent titles — never ids, names or location. */
export function trendingBrief(ctx: RecommendationContext): string {
  return JSON.stringify({
    task: 'order trending songs for this listener: taste first, then momentum; keep artists varied',
    hour: ctx.hour,
    languages: [...new Set([...ctx.pinnedLanguages, ...topLanguages(ctx.profile, 3).map((l) => l.id)])].slice(0, 5),
    avoidLanguages: ctx.mutedLanguages.slice(0, 5),
    artists: topArtists(ctx.profile, 8).map((a) => a.affinity.name),
    liked: ctx.favorites.slice(0, 8).map((s) => s.title),
    recent: ctx.history.slice(0, 8).map((e) => e.song.title),
    discovery: ctx.discoveryMode ?? 'balanced',
  });
}

export async function curateTrending(pool: Song[], ctx: RecommendationContext, options: CurateTrendingOptions): Promise<TrendingCuration> {
  const limit = Math.max(1, Math.min(30, Math.floor(options.limit ?? 20)));
  const rules = { mutedLanguages: ctx.mutedLanguages, blocked: options.blocked, hideExplicit: options.hideExplicit };
  const admitted = dedupeByIdentity(pool.filter((song) => rejectReasonFor(song, rules) === null), (s) => s);
  const ranked = rankCandidates(admitted.map((song) => ({ song, source: 'trending' as const })), { ...ctx, surface: 'home' }).map((r) => r.candidate.song);
  // Songs the scorer dropped (score <= 0) still belong on a trending shelf, after the ranked ones.
  const rankedIds = new Set(ranked.map((s) => s.id));
  const local = [...ranked, ...admitted.filter((s) => !rankedIds.has(s.id))];
  if (!options.allowAi || local.length < 4) return { songs: local.slice(0, limit), by: 'local' };

  const window = local.slice(0, 30);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const ordered = await Promise.race([
      aiRerankSongs(window, trendingBrief(ctx), window.length),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), Math.max(500, options.budgetMs ?? 4_000)); }),
    ]);
    // `aiRerankSongs` hands back the same songs when the engine gave nothing usable: that is not an AI order.
    const changed = !!ordered && ordered.some((s, i) => s.id !== window[i]?.id);
    if (!ordered || !changed) return { songs: local.slice(0, limit), by: 'local' };
    const allowed = new Set(window.map((s) => s.id));
    const safe = ordered.filter((s) => allowed.has(s.id));
    return { songs: safe.slice(0, limit), by: 'ai' };
  } catch {
    return { songs: local.slice(0, limit), by: 'local' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
