import { gatherCandidates } from './candidates';
import { rankCandidates, scoreCandidate } from './scoring';
import { buildMixes } from './mixes';
import { rotateTop } from './variety';
import { explainTopReasons } from './explanations';
import { useReasonStore } from '@/store/reasonStore';
import type { Mix, RecommendationContext, ScoredCandidate } from './types';

/** Package C4 — publish plain-words "why this song" lines for every pick the
 *  listener can actually see, so the track menu can answer "Why this song?".
 *  fillReasons never overwrites a richer AI DJ line. */
function publishReasons(scored: ScoredCandidate[]): void {
  try {
    useReasonStore
      .getState()
      .fillReasons(scored.map((s) => [s.candidate.song.id, explainTopReasons(s.reasons)]));
  } catch {
    /* a store hiccup must never break shelf building */
  }
}

function artistKeyOf(s: ScoredCandidate): string {
  const a = s.candidate.song.artists[0];
  return a?.id || a?.name?.toLowerCase() || '';
}

/**
 * Diversity-aware re-ordering for the autoqueue (MMR-lite). Taste score stays
 * dominant, but artists/languages are spread out so a continuation never stacks
 * the same artist back-to-back; a little novelty leaks in when intensity is low.
 */
function diversify(scored: ScoredCandidate[], intensity: number): ScoredCandidate[] {
  const remaining = [...scored];
  const out: ScoredCandidate[] = [];
  const artistCount = new Map<string, number>();
  const langCount = new Map<string, number>();
  const explore = 0.18 * (1 - Math.min(1, Math.max(0, intensity)));
  while (remaining.length && out.length < 60) {
    let bestIdx = 0;
    let bestVal = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const c = remaining[i];
      const aKey = artistKeyOf(c);
      const lang = c.candidate.song.language ?? '';
      const aPen = (artistCount.get(aKey) ?? 0) * 0.25;
      const lPen = (langCount.get(lang) ?? 0) * 0.012;
      const recentArtist =
        aKey && out.slice(-2).some((o) => artistKeyOf(o) === aKey) ? 0.4 : 0;
      const novel = c.candidate.source === 'trending' || c.candidate.source === 'rediscovery';
      const val = c.score - aPen - lPen - recentArtist + (novel ? explore : 0);
      if (val > bestVal) {
        bestVal = val;
        bestIdx = i;
      }
    }
    const [picked] = remaining.splice(bestIdx, 1);
    out.push(picked);
    const aKey = artistKeyOf(picked);
    const lang = picked.candidate.song.language ?? '';
    artistCount.set(aKey, (artistCount.get(aKey) ?? 0) + 1);
    langCount.set(lang, (langCount.get(lang) ?? 0) + 1);
  }
  return out;
}

interface MemoEntry {
  key: string;
  at: number;
  mixes: Mix[];
}

let memo: MemoEntry | null = null;
const MEMO_TTL_MS = 10 * 60_000;

function ctxKey(ctx: RecommendationContext): string {
  return [
    ctx.profile.totals.plays,
    ctx.profile.totals.favorites,
    ctx.profile.totals.skips,
    ctx.hour,
    ctx.pinnedLanguages.join(','),
    ctx.mutedLanguages.join(','),
    Math.round(ctx.intensity * 10),
    ctx.explore ? 1 : 0,
    ctx.salt,
    ctx.region?.country ?? '',
    // Decay runs off updatedAt — bucketed so long sessions refresh shelves.
    Math.floor(ctx.profile.updatedAt / (15 * 60_000)),
  ].join('|');
}

/**
 * Entry point: gather → rank → assemble shelves. Pure local computation plus
 * fault-tolerant upstream metadata fetches. Memoized for 10 minutes per
 * profile state so navigation stays instant and playback is never blocked.
 */
export async function buildRecommendations(ctx: RecommendationContext): Promise<Mix[]> {
  const key = ctxKey(ctx);
  if (memo && memo.key === key && Date.now() - memo.at < MEMO_TTL_MS) return memo.mixes;
  const candidates = await gatherCandidates(ctx);
  const ranked = rankCandidates(candidates, ctx);
  const mixes = buildMixes(ranked, ctx);
  // C4 — every song placed on a shelf gets its honest "why" line.
  const placed = new Set(mixes.flatMap((m) => m.songs.map((s) => s.id)));
  publishReasons(ranked.filter((s) => placed.has(s.candidate.song.id)));
  memo = { key, at: Date.now(), mixes };
  return mixes;
}

let _lastSource: 'ai' | 'instant' = 'instant';
/** Which engine served the most recent continuation — AI curator or the
 *  instant local fallback. Surfaced in the player for honest labeling. */
export function lastQueueSource(): 'ai' | 'instant' {
  return _lastSource;
}

/** Ranked pool for "similar tracks autoqueue" — reuses the same scorer. */
export async function similarToSong(
  songId: string,
  ctx: RecommendationContext,
  exclude?: Set<string>,
): Promise<ScoredCandidate[]> {
  // `exclude` is the anti-repeat set (recently played + current queue) — these
  // ids are dropped from the candidate pool so the auto-queue stops looping the
  // same songs.
  const ex = exclude ?? new Set<string>();
  _lastSource = 'instant';
  // AI DJ (opt-in): when enabled, let the AI build the continuation; fall back to
  // the local related-tracks engine on any failure or empty result.
  try {
    const { aiSimilarSongs } = await import('@/services/ai/dj');
    // Hard deadline: the listener never waits on the AI. If it can't answer in
    // 12s, this round falls through to the instant local engine instead.
    const aiSongs = await Promise.race([
      aiSimilarSongs(songId, ctx, 14),
      new Promise<never[]>((resolveRace) => window.setTimeout(() => resolveRace([]), 12_000)),
    ]);
    const fresh = aiSongs.filter((song) => !ex.has(song.id));
    if (fresh.length) {
      // Blend the AI's flow/intent ordering with the local taste score, then
      // diversify: earlier AI picks get a gentle nudge, but a track you'd skip
      // still sinks.
      const scored = fresh
        .map((song, i, arr) => {
          const sc = scoreCandidate({ song, source: 'related' as const }, ctx);
          return { ...sc, score: sc.score + 0.12 * (1 - i / arr.length) };
        })
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score);
      if (scored.length) {
        _lastSource = 'ai';
        // Seed-rotate the leading picks so consecutive continuations from the
        // same seed differ (the salt is random per extend call).
        return rotateTop(diversify(scored, ctx.intensity), ctx.salt);
      }
    }
  } catch {
    /* fall through to the local engine */
  }
  const { getSongSuggestions } = await import('@/services/api');
  try {
    const songs = await getSongSuggestions(songId, 18);
    // rankCandidates already tier-shuffles by salt; rotateTop then rotates the
    // very top band too, so the leading next-song picks aren't frozen when a
    // few candidates sit alone in their own score tiers.
    const picks = rotateTop(
      diversify(
        rankCandidates(
          songs
            .filter((song) => !ex.has(song.id))
            .map((song) => ({ song, source: 'related' as const })),
          ctx,
        ),
        ctx.intensity,
      ),
      ctx.salt,
    );
    // C4 — the instant local queue gets "why" lines too (AI lines, when the AI
    // path served instead, were already set and are never overwritten).
    publishReasons(picks);
    return picks;
  } catch {
    return [];
  }
}

export function invalidateRecommendationCache(): void {
  memo = null;
}
