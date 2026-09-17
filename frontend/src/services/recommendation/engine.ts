import { gatherCandidates, generateNextCandidates } from './candidates';
import { buildScoringFrame, effectiveDiscoveryMode, rankCandidates } from './scoring';
import type { HardFilterOptions } from './filters';
import type { ValidateOptions } from './validation';
import type { DebugTrace } from '@/store/recsDebugStore';
import { topLanguages } from '@/services/personalization/profile';
import { buildMixes } from './mixes';
import { servedKeySet, songKey } from './songIdentity';
import { explainTopReasons } from './explanations';
import { useReasonStore } from '@/store/reasonStore';
import type { Mix, RecommendationContext, RejectedCandidate, ScoredCandidate } from './types';
import type { Song } from '@/types';
import { enrichSongs, aiRerankSongs } from '@/services/ai/recommendations';
import { rerankCandidates } from './reranking';
import { isSongBlocked, useLibraryStore } from '@/store/libraryStore';
import { kidModeOn } from '@/services/kidMode';
import { useSettingsStore } from '@/store/settingsStore';
import { queryClient } from '@/services/queryClient';
import type { ArcShape } from './sequencer';
import { tunePromptHint, tuneScoreAdjust, tuneShape, type TuneIntent } from './tune';

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
    ctx.discoveryMode ?? '',
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
  /** v6.5.0 — an active "Tune this queue" intent: reshapes the score, the arc, the language lock and the DJ brief. */
  tune?: TuneIntent | null;
}

/** Share of a queue that may go to artists the listener has never played, per discovery mode. */
const DISCOVERY_SHARE = { familiar: 0.05, balanced: 0.2, discover: 0.45 } as const;

/**
 * Shared continuation entry point for autoplay, radio and playlist queues.
 *
 * v7.0.0 — one explicit pipeline, each stage in code and each stage traced
 * for the developer breakdown (`?debug=recs`):
 *
 *   1  candidate generation   seed-related, artist, language, taste-wide, rediscovery (./candidates)
 *   2  hard filtering         rules with a named reason per rejection (./filters)
 *   3  feature extraction     classifier metadata: mood, genre, energy, tempo (bounded wait)
 *   4  context scoring        taste, seed similarity, time, session vector (./scoring)
 *   5  diversity + repeats    MMR re-rank, artist fatigue, recent-play demotion
 *   6  session adjustment     this sitting's intent: skips, likes, searches, queue-adds
 *   7  exploration tuning     Familiar / Balanced / Discover: novelty lean and discovery share
 *   8  ranking                the scored, re-ranked pool (plus any "Tune this queue" nudge)
 *   9  queue sequencing       energy arc, mood flow, transitions, spacing, language policy (./sequencer)
 *  9b  AI DJ (optional)       may re-order the pool and propose catalogue-verified songs
 *  10  validation             the final order re-checked against every rule (./validation)
 *
 * The AI never writes to the queue: whatever it returns goes through stage
 * 10, and when it is slow, down, wrong or unconfigured the local order —
 * validated the same way — ships instead.
 */
export async function recommendNextSongs(seed: Song, ctx: RecommendationContext, options: NextRecommendationOptions = {}): Promise<Song[]> {
  const limit = Math.max(0, Math.min(40, Math.floor(options.limit ?? 8)));
  if (!limit) return [];
  const nextCtx: RecommendationContext = { ...ctx, seedSong: seed, surface: ctx.surface ?? 'next' };
  const mode = effectiveDiscoveryMode(nextCtx);
  const intent = nextCtx.sessionIntent ?? null;
  const tune = options.tune ?? null;
  const library = useLibraryStore.getState();

  // 1 — candidate generation. The rule modules are lazy, like the sequencer:
  // this engine rides the first-load player store, and none of them is needed
  // until a queue is actually extended.
  const [candidates, { hardFilter, rejectReasonFor }] = await Promise.all([generateNextCandidates(seed, nextCtx), import('./filters')]);

  // 2 — hard filtering (before enrichment, so the classifier only sees songs that can play).
  const rules: HardFilterOptions = {
    seed,
    queuedIds: new Set(options.excludeIds ?? []),
    queuedKeys: new Set(options.excludeKeys ?? []),
    recentIds: new Set(ctx.profile.recentSongIds),
    recentKeys: new Set(ctx.history.slice(0, 20).map((e) => songKey(e.song))),
    sessionSkippedIds: intent?.skippedSongIds,
    mutedLanguages: ctx.mutedLanguages,
    blocked: (song) => isSongBlocked(song, library),
    hideExplicit: kidModeOn(),
  };
  const filtered = hardFilter(candidates, rules);
  const rejected: RejectedCandidate[] = [...filtered.rejected];

  // 3 — feature extraction. Continuation has a short foreground window for the
  // low-cost classifier so fresh mood/genre/energy metadata can affect this decision.
  const enriched = await enrichSongs(filtered.admitted.map((candidate) => candidate.song), { waitMs: 1_800 });
  const enrichedById = new Map(enriched.map((song) => [song.id, song]));

  // 4–8 — scoring, diversity, session adjustment, exploration tuning, ranking.
  let ranked = rankCandidates(
    filtered.admitted.map((candidate) => ({ ...candidate, song: enrichedById.get(candidate.song.id) ?? candidate.song })),
    nextCtx,
    (dropped) => rejected.push({ song: dropped.candidate.song, reason: 'low-score', stage: 'rank' }),
  );
  // v6.5.2 — the AI re-rank and the AI DJ both order the same pool; running
  // both in series doubled the wait before a continuation could ship. When
  // the DJ is on, it is the AI voice for this stretch.
  if (!aiDjEnabled()) ranked = await blendAi(ranked, nextCtx);
  const seedLang = seed.language && seed.language !== 'unknown' ? seed.language : null;
  if (tune) {
    // v6.5.0 — the on-device half of a tune: a deterministic nudge per song
    // so the intent holds even when the DJ is unavailable.
    ranked = ranked.map((item) => ({ ...item, score: item.score + tuneScoreAdjust(item.candidate.song, tune, seedLang) })).sort((a, b) => b.score - a.score);
  }
  const orderedPool: Song[] = ranked.map((item) => item.candidate.song);

  // 9 — queue sequencing. Lazy: this engine rides the first-load player store;
  // the sequencer and the session-context reader are only needed once a queue is extended.
  const [{ sequenceSongs, arcErrorOf }, { readListenerEnergy }, { validateSequence }] = await Promise.all([import('./sequencer'), import('@/services/ai/sessionContext'), import('./validation')]);
  // A live skip streak outranks the slower history read: come up and re-anchor now.
  const shape = (tune && tuneShape(tune)) || (intent && intent.skipStreak >= 2 ? 'lift' : shapeFor(readListenerEnergy(ctx.history, ctx.hour)));
  const sureIds = new Set([...ctx.favorites.map((s) => s.id), ...ctx.history.slice(0, 60).map((e) => e.song.id)]);
  // Discovery = an artist this listener has never played (or an explore-source pick).
  const frame = buildScoringFrame(nextCtx);
  const discoveryIds = new Set(
    ranked
      .filter((item) => item.candidate.source === 'explore' || !frame.knownArtists.has((item.candidate.song.artists[0]?.name ?? '').trim().toLowerCase()))
      .map((item) => item.candidate.song.id),
  );
  // Language rule: the queue speaks the seed's language. In Discover mode it
  // may take an occasional detour into another language the listener plays.
  // "Switch language" moves the lock to another language the listener plays.
  const switchTo = tune === 'different-language'
    ? ctx.pinnedLanguages.find((l) => l !== seedLang) ?? orderedPool.map((s) => s.language).find((l) => l && l !== 'unknown' && l !== seedLang) ?? null
    : null;
  const lock = switchTo ?? seedLang;
  const otherLanguages = ctx.pinnedLanguages.filter((l) => l !== lock);
  const roam = mode === 'discover' || tune === 'surprise';
  const drift = roam && tune !== 'same-language';
  const discoveryShare = Math.max(0, Math.min(0.5, (tune === 'surprise' ? DISCOVERY_SHARE.discover : DISCOVERY_SHARE[mode]) + (intent ? intent.discoveryAppetite * 0.15 : 0)));
  const arc = sequenceSongs(orderedPool.slice(0, 40), { seed, shape, limit, language: lock, languagePolicy: drift ? 'prefer' : 'lock', otherLanguages, discovery: discoveryShare, discoveryIds, sureIds, recent: ctx.history.slice(0, 3).map((e) => e.song) });

  // 10 — validation. The arc first, then the rest of the ranked pool as the
  // reserve a short or language-locked arc is topped up from.
  const familiarLanguages = [...new Set([...ctx.pinnedLanguages, ...topLanguages(ctx.profile, 3).map((l) => l.id)])];
  const validateOptions: ValidateOptions = { ...rules, limit, lockLanguage: drift ? null : lock, familiarLanguages };
  const arcIds = new Set(arc.songs.map((s) => s.song.id));
  const local = validateSequence([...arc.songs.map((s) => s.song), ...orderedPool.filter((s) => !arcIds.has(s.id))], validateOptions);
  const songs = local.songs;
  const trace: DebugTrace = { mode, shape, lock, languagePolicy: drift ? 'prefer' : 'lock', discoveryShare, intent: intent ? { skipStreak: intent.skipStreak, completionStreak: intent.completionStreak, discoveryAppetite: intent.discoveryAppetite, energySteer: intent.energySteer } : null, stages: { candidates: candidates.length, admitted: filtered.admitted.length, ranked: ranked.length, sequenced: arc.songs.length, validated: songs.length }, relaxed: local.relaxed, repairs: local.repairs };
  publishReasons(ranked.filter((item) => songs.some((song) => song.id === item.candidate.song.id)));
  // Arc reasons are more specific than scorer reasons; let them win.
  useReasonStore.getState().setReasons(arc.songs.filter((s) => s.why).map((s) => [s.song.id, s.why]));
  publishDebug(ranked, songs, 'local', { trace, rejected: [...rejected, ...local.rejected] });

  // 9b — the AI DJ gets a bounded, optional say over the ORDER of the admitted
  // pool, and may propose a few songs from outside it. Off by setting or owner
  // flag, or when the DJ is slow/down/unconfigured, the local order ships.
  if (aiDjEnabled() && songs.length >= 3) {
    // The DJ client is a lazy chunk: it only matters once a queue is actually being extended.
    const { djSequence, samplePool } = await import('@/services/ai/dj');
    // v6.5.0 — a rotating slice of the ranked pool (top ranks always, the
    // rest sampled) so consecutive rounds hand the DJ different material.
    const pool = samplePool(orderedPool.slice(0, 40), 10, 30);
    // v6.5.0 — the generative half: each proposal is verified in the catalogue
    // and must pass the same rules as everything else before it can be queued.
    const gate = { language: drift ? null : lock, admit: (song: Song) => rejectReasonFor(song, rules) === null };
    const set = await djSequence(seed, nextCtx, pool, limit, undefined, { shape, discover: true, gate, ...(tune ? { tune: tunePromptHint(tune) } : {}) });
    if (set && set.picks.length >= Math.min(3, limit)) {
      const used = new Set<string>();
      const proposed: Song[] = [];
      for (const p of set.picks) if (!used.has(p.song.id)) { used.add(p.song.id); proposed.push(p.song); }
      for (const s of songs) if (!used.has(s.id)) { used.add(s.id); proposed.push(s); }
      // The DJ's order goes through the same validation as the local one, and
      // is accepted only when it still keeps the arc about as tight (a tune
      // relaxes the tolerance: the listener asked for a change of direction).
      const checked = validateSequence(proposed, validateOptions);
      if (checked.songs.length >= Math.min(3, limit) && arcErrorOf(checked.songs, seed, shape) <= arcErrorOf(songs, seed, shape) + (tune ? 0.2 : 0.08)) {
        publishDebug(ranked, checked.songs, 'ai', {
          trace: { ...trace, stages: { ...trace.stages, validated: checked.songs.length }, relaxed: checked.relaxed, repairs: checked.repairs },
          rejected: [...rejected, ...checked.rejected],
          confidence: new Map(set.picks.map((p) => [p.song.id, p.confidence])),
          discovered: new Set(set.picks.filter((p) => p.discovered).map((p) => p.song.id)),
        });
        return checked.songs;
      }
    }
  }
  return songs;
}

/** v6.4.0 / v7.0.0 — development-only score breakdowns for the recs debug panel (no-op unless enabled). */
function publishDebug(ranked: ScoredCandidate[], chosen: Song[], source: 'local' | 'ai', extra: { trace?: DebugTrace; rejected?: RejectedCandidate[]; confidence?: Map<string, number>; discovered?: Set<string> } = {}): void {
  void import('@/store/recsDebugStore').then((m) => {
    if (!m.recsDebugEnabled()) return;
    const byId = new Map(ranked.map((r) => [r.candidate.song.id, r]));
    const rankOf = new Map(ranked.map((r, i) => [r.candidate.song.id, i + 1]));
    const chosenIds = new Set(chosen.map((s) => s.id));
    m.useRecsDebugStore.getState().publish(
      chosen.map((song, i) => {
        const r = byId.get(song.id);
        return { position: i + 1, rank: rankOf.get(song.id), song, finalScore: r?.score ?? 0, source: r?.candidate.source ?? (extra.discovered?.has(song.id) ? 'dj-discovery' : 'unknown'), components: r?.reasons ?? [], picker: source, confidence: extra.confidence?.get(song.id) };
      }),
      {
        trace: extra.trace,
        rejected: extra.rejected ?? [],
        // Ranked but not chosen: what the sequencer passed over, best first.
        passedOver: ranked.filter((r) => !chosenIds.has(r.candidate.song.id)).slice(0, 15).map((r) => ({ song: r.candidate.song, rank: rankOf.get(r.candidate.song.id) ?? 0, finalScore: r.score, source: r.candidate.source, components: r.reasons })),
      },
    );
  }).catch(() => undefined);
}

/** Arc shape from the listener-energy read (same signal the AI DJ gets). */
export function shapeFor(energy: string): ArcShape {
  if (energy.startsWith('restless') || energy.startsWith('wavering')) return 'lift';
  if (energy.includes('late hours')) return 'wind-down';
  return 'steady';
}

/** Listener switch AND owner flag (read from the cached config; a missing flag means on). */
function aiDjEnabled(): boolean {
  if (!useSettingsStore.getState().aiDj) return false;
  const flags = queryClient.getQueryData<Record<string, boolean>>(['feature-flags']);
  return flags?.aiDj !== false;
}

export async function startRadioRecommendations(seed: Song, ctx: RecommendationContext, limit = 30): Promise<Song[]> {
  return recommendNextSongs(seed, { ...ctx, surface: 'radio', intensity: Math.max(ctx.intensity, 0.65) }, { limit, excludeIds: [seed.id] });
}

export async function continuePlaylist(seed: Song, ctx: RecommendationContext, options: NextRecommendationOptions = {}): Promise<Song[]> {
  return recommendNextSongs(seed, { ...ctx, surface: 'playlist' }, options);
}
