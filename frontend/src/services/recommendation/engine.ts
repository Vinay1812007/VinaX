import { gatherCandidates, generateNextCandidates } from './candidates';
import { rankCandidates } from './scoring';
import { buildMixes } from './mixes';
import { servedKeySet, songKey } from './songIdentity';
import { explainTopReasons } from './explanations';
import { useReasonStore } from '@/store/reasonStore';
import type { Mix, RecommendationContext, ScoredCandidate } from './types';
import type { Song } from '@/types';
import { enrichSongs, aiRerankSongs } from '@/services/ai/recommendations';
import { freshSongs } from './freshness';
import { rerankCandidates } from './reranking';
import { isSongBlocked, useLibraryStore } from '@/store/libraryStore';
import { stripExplicit } from '@/services/kidMode';

function aiContext(ctx: RecommendationContext): string {
  return JSON.stringify({ surface: ctx.surface, seed: ctx.seedSong?.title, mood: ctx.sessionMood, energy: ctx.sessionEnergy,
    languages: ctx.pinnedLanguages, muted: ctx.mutedLanguages,
    favorites: ctx.favorites.slice(0, 8).map(s => s.title), skips: ctx.profile.skippedSongIds?.slice(0, 20),
    recent: ctx.history.slice(0, 10).map(e => ({ id: e.song.id, title: e.song.title, completed: e.completed })),
    artists: Object.values(ctx.profile.artists).sort((a, b) => b.score - a.score).slice(0, 8).map(a => a.name) });
}

async function blendAi(ranked: ScoredCandidate[], ctx: RecommendationContext): Promise<ScoredCandidate[]> {
  const window = ranked.slice(0, 30);
  const order = await aiRerankSongs(window.map(item => item.candidate.song), aiContext(ctx), 30);
  const positions = new Map(order.map((song, index) => [song.id, index]));
  return rerankCandidates(ranked.map(item => ({ ...item, score: item.score + (positions.has(item.candidate.song.id) ? 0.12 * (1 - positions.get(item.candidate.song.id)! / Math.max(order.length, 1)) : 0) })), ctx);
}

/** Package C4 — publish plain-words "why this song" lines for every pick the
 *  listener can actually see, so the track menu can answer "Why this song?".
 *  Existing explanations are preserved. */
function publishReasons(scored: ScoredCandidate[]): void {
  try {
    useReasonStore
      .getState()
      .fillReasons(scored.map((s) => [s.candidate.song.id, explainTopReasons(s.reasons)]));
  } catch {
    /* a store hiccup must never break shelf building */
  }
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
    ctx.profile.createdAt,
    ctx.profile.recentSongIds.join(','),
    JSON.stringify(ctx.profile.sliders),
    JSON.stringify(ctx.profile.softMuted),
    JSON.stringify(useLibraryStore.getState().hiddenSongIds),
    JSON.stringify(useLibraryStore.getState().hiddenArtists),
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
  const enriched = await enrichSongs(candidates.map((candidate) => candidate.song));
  const enrichedById = new Map(enriched.map((song) => [song.id, song]));
  let ranked = rankCandidates(candidates.map((candidate) => ({ ...candidate, song: enrichedById.get(candidate.song.id) ?? candidate.song })), ctx);
  // On a warm profile, let a stronger routed seat understand the whole Home
  // context and reorder a bounded top window. Cold-start Home remains instant
  // and deterministic; failures simply preserve the local order.
  if (ctx.surface === 'home' && ctx.profile.totals.plays >= 5 && ranked.length >= 4) {
    ranked = await blendAi(ranked, ctx);
  }
  const served = servedKeySet();
  const freshRanked = [...ranked.filter((s) => !served.has(songKey(s.candidate.song))), ...ranked.filter((s) => served.has(songKey(s.candidate.song)))];
  const mixes = buildMixes(freshRanked, ctx);
  // C4 — every song placed on a shelf gets its honest "why" line.
  const placed = new Set(mixes.flatMap((m) => m.songs.map((s) => s.id)));
  publishReasons(ranked.filter((s) => placed.has(s.candidate.song.id)));
  memo = { key, at: Date.now(), mixes };
  return mixes;
}

export function invalidateRecommendationCache(): void {
  memo = null;
}

export interface NextRecommendationOptions {
  limit?: number;
  excludeIds?: string[];
  excludeKeys?: string[];
}

/** Shared continuation entry point for autoplay, radio and playlist queues. */
export async function recommendNextSongs(seed: Song, ctx: RecommendationContext, options: NextRecommendationOptions = {}): Promise<Song[]> {
  const limit = Math.max(0, Math.min(40, Math.floor(options.limit ?? 8)));
  if (!limit) return [];
  const excluded = new Set([seed.id, ...ctx.profile.recentSongIds, ...(options.excludeIds ?? [])]);
  const candidates = await generateNextCandidates(seed, { ...ctx, seedSong: seed, surface: ctx.surface ?? 'next' });
  // Continuation has a short foreground window for the low-cost classifier so
  // fresh mood/genre/energy metadata can affect this next-song decision.
  const enriched = await enrichSongs(candidates.map((candidate) => candidate.song), { waitMs: 1_800 });
  const enrichedById = new Map(enriched.map((song) => [song.id, song]));
  const admitted = freshSongs(stripExplicit(enriched), { excludeIds: excluded,
    excludeKeys: new Set([songKey(seed), ...(options.excludeKeys ?? []), ...ctx.history.slice(0, 20).map(e => songKey(e.song))]),
    muted: ctx.mutedLanguages, blocked: song => isSongBlocked(song, useLibraryStore.getState()) });
  const admittedIds = new Set(admitted.map(s => s.id));
  let ranked = rankCandidates(candidates.filter(c => admittedIds.has(c.song.id)).map((candidate) => ({ ...candidate, song: enrichedById.get(candidate.song.id) ?? candidate.song })), { ...ctx, seedSong: seed, surface: ctx.surface ?? 'next' });
  ranked = await blendAi(ranked, { ...ctx, seedSong: seed });
  const songs: Song[] = [];
  for (const item of ranked) {
    const song = item.candidate.song;
    if (song.id === seed.id || excluded.has(song.id)) continue;
    if (songs.some((s) => s.id === song.id)) continue;
    songs.push(song);
    if (songs.length >= limit) break;
  }
  publishReasons(ranked.filter((item) => songs.some((song) => song.id === item.candidate.song.id)));
  // Stronger routed models get a bounded, optional final say for continuation
  // surfaces. Any timeout/invalid JSON returns the deterministic ordering.
  return songs;
}

export async function startRadioRecommendations(seed: Song, ctx: RecommendationContext, limit = 30): Promise<Song[]> {
  return recommendNextSongs(seed, { ...ctx, surface: 'radio', intensity: Math.max(ctx.intensity, 0.65) }, { limit, excludeIds: [seed.id] });
}

export async function continuePlaylist(seed: Song, ctx: RecommendationContext, options: NextRecommendationOptions = {}): Promise<Song[]> {
  return recommendNextSongs(seed, { ...ctx, surface: 'playlist' }, options);
}
