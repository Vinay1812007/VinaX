import type { Song } from '@/types';
import type { RecommendationContext } from './types';
import { rankCandidates } from './scoring';
import { rejectReasonFor } from './filters';
import { dedupeByIdentity } from './songIdentity';

/**
 * v7.0.1 — "Popular picks for you": what is trending in the catalogue,
 * ordered for THIS listener on the device.
 *
 * The pool is real trending search results, nothing else. It passes the same
 * hard rules as a queue (mutes, blocks, explicit, junk, one cut per song),
 * then the on-device scorer orders it by taste.
 */
export interface TrendingForYouOptions {
  limit?: number;
  blocked?: (song: Song) => boolean;
  hideExplicit?: boolean;
}

export function orderTrendingForYou(pool: Song[], ctx: RecommendationContext, options: TrendingForYouOptions = {}): Song[] {
  const limit = Math.max(1, Math.min(30, Math.floor(options.limit ?? 20)));
  // 7.2.0 — soft mutes ("show fewer like this") are a hard rule here too.
  const rules = { mutedLanguages: ctx.mutedLanguages, blocked: options.blocked, hideExplicit: options.hideExplicit, softMuted: ctx.profile?.softMuted };
  const admitted = dedupeByIdentity(pool.filter((song) => rejectReasonFor(song, rules) === null), (s) => s);
  const ranked = rankCandidates(admitted.map((song) => ({ song, source: 'trending' as const })), { ...ctx, surface: 'home' }).map((r) => r.candidate.song);
  // Songs the scorer dropped (score <= 0) still belong on a trending shelf, after the ranked ones.
  const rankedIds = new Set(ranked.map((s) => s.id));
  return [...ranked, ...admitted.filter((s) => !rankedIds.has(s.id))].slice(0, limit);
}
