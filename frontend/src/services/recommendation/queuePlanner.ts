import type { Song } from '@/types';
import { gatherCandidates, generateNextCandidates } from './candidates';
import { rankCandidates } from './scoring';
import { getRecommendationContext } from './context';
import { enrichSongs } from '@/services/ai/recommendations';
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
 * duration. Optionally the AI DJ adds an intro, reasons and segues. The
 * plan is a PREVIEW: nothing touches the queue until the listener applies it.
 */
export type DiscoveryLevel = 'low' | 'medium' | 'high';

export interface PlanRequest {
  seed?: Song | null;
  mood?: Mood | 'any';
  shape: ArcShape;
  minutes: number;
  discovery: DiscoveryLevel;
  language?: string | null;
  /** Plain words for the DJ ("for a night drive"). */
  goal?: string;
  useDj?: boolean;
}

export interface QueuePlan {
  songs: SequencedSong[];
  totalSec: number;
  arcError: number;
  intro: string | null;
  /** True when the AI DJ contributed reasons/segues. */
  djTouched: boolean;
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
  if (!admitted.length) return { songs: [], totalSec: 0, arcError: 0, intro: null, djTouched: false, candidates: 0 };
  const enriched = await enrichSongs(admitted.map((c) => c.song), { waitMs: 1_500 });
  const byId = new Map(enriched.map((s) => [s.id, s]));
  const ranked = rankCandidates(admitted.map((c) => ({ ...c, song: byId.get(c.song.id) ?? c.song })), { ...ctx, seedSong: seed });
  const pool = ranked.map((r) => r.candidate.song);
  const discoveryIds = new Set(ranked.filter((r) => r.candidate.source === 'explore' || r.candidate.source === 'trending').map((r) => r.candidate.song.id));
  const sureIds = new Set([...lib.favorites.map((s) => s.id), ...history.map((e) => e.song.id)]);
  const targetSec = Math.max(5, Math.min(240, req.minutes)) * 60;
  const arc = sequenceSongs(pool.slice(0, 60), { seed, shape: req.shape, durationSec: targetSec, limit: Math.min(60, Math.ceil(targetSec / 150)), language: req.language ?? null, discovery: DISCOVERY_SHARE[req.discovery], discoveryIds, sureIds, recent: history.slice(0, 3).map((e) => e.song) });
  let intro: string | null = null;
  let djTouched = false;
  let songs = arc.songs;
  if (req.useDj && arc.songs.length >= 3 && useSettingsStore.getState().aiDj) {
    try {
      const { djSequence } = await import('@/services/ai/dj');
      const set = await djSequence(seed, { ...ctx, seedSong: seed }, arc.songs.map((s) => s.song), arc.songs.length, undefined, { shape: req.shape, goal: req.goal });
      if (set) {
        intro = set.intro || null;
        djTouched = true;
        const notes = new Map(set.picks.map((p) => [p.song.id, p.reason]));
        songs = arc.songs.map((s) => (notes.get(s.song.id) ? { ...s, why: notes.get(s.song.id) as string } : s));
      }
    } catch {
      /* the local plan stands */
    }
  }
  return { songs, totalSec: arc.totalSec, arcError: arc.arcError, intro, djTouched, candidates: admitted.length };
}
