import type { Song } from '@/types';
import { gatherCandidates, generateNextCandidates } from './candidates';
import { buildScoringFrame, rankCandidates } from './scoring';
import { validateSequence } from './validation';
import { getRecommendationContext } from './context';
import { freshSongs } from './freshness';
import { songKey } from './songIdentity';
import { inferMood, moodMatchScore, type Mood } from './mood';
import { sequenceSongs, type ArcShape, type SequencedSong } from './sequencer';
import { stripExplicit } from '@/services/kidMode';
import { isSongBlocked, useLibraryStore } from '@/store/libraryStore';
import { useHistoryStore } from '@/store/historyStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { Candidate } from './types';

/**
 * v6.3.0 — the Queue Builder's planner. "Thirty minutes, upbeat, Telugu, a
 * little discovery" becomes: gather real candidates (seed-first when a seed
 * is given, taste-wide otherwise), admit them through the same gates every
 * queue passes (language, mute, block, explicit, junk, de-dup), rank by
 * taste, then let the arc sequencer lay them out to the requested shape and
 * duration. The plan is a PREVIEW: nothing touches the queue until the listener applies it.
 */
export type DiscoveryLevel = 'low' | 'medium' | 'high';

export interface PlanRequest {
  seed?: Song | null;
  mood?: Mood | 'any';
  shape: ArcShape;
  minutes: number;
  discovery: DiscoveryLevel;
  language?: string | null;
}

export interface QueuePlan {
  songs: SequencedSong[];
  totalSec: number;
  arcError: number;
  candidates: number;
}

const DISCOVERY_SHARE: Record<DiscoveryLevel, number> = { low: 0.05, medium: 0.2, high: 0.4 };

/** Pure admission + mood filter, exported for tests. */
export function admitForPlan(candidates: Candidate[], req: PlanRequest, opts: { muted: string[]; blocked: (s: Song) => boolean; recentKeys: Set<string> }): Candidate[] {
  const byId = new Map<string, Candidate>();
  for (const c of candidates) if (c.song?.id && !byId.has(c.song.id)) byId.set(c.song.id, c);
  const admitted = freshSongs(stripExplicit([...byId.values()].map((c) => c.song)), { excludeKeys: opts.recentKeys, language: req.language ?? null, muted: opts.muted, blocked: opts.blocked });
  const ok = new Set(admitted.map((s) => s.id));
  const mood = req.mood && req.mood !== 'any' ? req.mood : null;
  return [...byId.values()].filter((c) => ok.has(c.song.id) && (!mood || moodMatchScore(mood, inferMood(c.song)) >= 0.4));
}

export async function planQueue(req: PlanRequest): Promise<QueuePlan> {
  const seed = req.seed ?? null;
  const ctx = getRecommendationContext(seed, seed ? 'radio' : 'home');
  const [seeded, wide] = await Promise.all([seed ? generateNextCandidates(seed, ctx).catch(() => [] as Candidate[]) : Promise.resolve([] as Candidate[]), gatherCandidates(ctx).catch(() => [] as Candidate[])]);
  const lib = useLibraryStore.getState();
  const history = useHistoryStore.getState().entries;
  const recentKeys = new Set([...(seed ? [songKey(seed)] : []), ...history.slice(0, 10).map((e) => songKey(e.song))]);
  const admitted = admitForPlan([...seeded, ...wide], req, { muted: useSettingsStore.getState().mutedLanguages, blocked: (s) => isSongBlocked(s, lib), recentKeys });
  if (!admitted.length) return { songs: [], totalSec: 0, arcError: 0, candidates: 0 };
  const ranked = rankCandidates(admitted, { ...ctx, seedSong: seed });
  const pool = ranked.map((r) => r.candidate.song);
  // v7.0.0 — "discovery" means an artist this listener has never played (or an
  // explore pick), the same definition the next-song pipeline uses; it used to
  // be "anything from a trending search", which counted the listener's own
  // favourite artists as discoveries whenever they were trending.
  const known = buildScoringFrame({ ...ctx, seedSong: seed }).knownArtists;
  const discoveryIds = new Set(ranked.filter((r) => r.candidate.source === 'explore' || !known.has((r.candidate.song.artists[0]?.name ?? '').trim().toLowerCase())).map((r) => r.candidate.song.id));
  const sureIds = new Set([...lib.favorites.map((s) => s.id), ...history.map((e) => e.song.id)]);
  const targetSec = Math.max(5, Math.min(240, req.minutes)) * 60;
  const arc = sequenceSongs(pool.slice(0, 60), { seed, shape: req.shape, durationSec: targetSec, limit: Math.min(60, Math.ceil(targetSec / 150)), language: req.language ?? null, discovery: DISCOVERY_SHARE[req.discovery], discoveryIds, sureIds, recent: history.slice(0, 3).map((e) => e.song) });
  // The plan passes the same final rules as any queue (one cut per song, mutes,
  // blocks); the arc's order is kept, a rejected song simply leaves it.
  const allowed = new Set(validateSequence(arc.songs.map((s) => s.song), { seed, limit: arc.songs.length, artistCap: Math.max(2, Math.ceil(arc.songs.length / 4)), mutedLanguages: useSettingsStore.getState().mutedLanguages, blocked: (s) => isSongBlocked(s, lib) }).songs.map((s) => s.id));
  arc.songs = arc.songs.filter((s) => allowed.has(s.song.id));
  return { songs: arc.songs, totalSec: arc.totalSec, arcError: arc.arcError, candidates: admitted.length };
}
