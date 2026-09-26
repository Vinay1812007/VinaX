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
import type { Candidate, Mix, RecommendationContext, RejectedCandidate, ScoredCandidate } from './types';
import type { Song } from '@/types';
import { enrichSongs, aiRerankSongs } from '@/services/ai/recommendations';
import { rerankCandidates } from './reranking';
import { isSongBlocked, useLibraryStore } from '@/store/libraryStore';
import { kidModeOn } from '@/services/kidMode';
import { useSettingsStore } from '@/store/settingsStore';
import { queryClient } from '@/services/queryClient';
import type { ArcShape } from './sequencer';
import { tunePromptHint, tuneScoreAdjust, tuneSearchQuery, tuneShape, type TuneIntent } from './tune';
import type { Mood } from './mood';
import { activeWeightsVersion } from './weights';
import { NEXT_DEADLINE_MS, NEXT_URGENT_DEADLINE_MS } from './deadlines';
import { trendSignalNow } from '@/services/trends/signal';

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
export async function buildRecommendations(rawCtx: RecommendationContext): Promise<Mix[]> {
  const trend = trendSignalNow(rawCtx);
  const ctx: RecommendationContext = { ...rawCtx, trendBonus: trend.bonus, trendLabel: trend.label };
  const key = ctxKey(ctx);
  if (memo && memo.key === key && Date.now() - memo.at < MEMO_TTL_MS) return memo.mixes;
  // 7.2.0 — bounded gathering: slow optional sources are not waited for once a useful pool exists.
  const [candidates, { classifiedFields }] = await Promise.all([gatherCandidates(ctx, { softDeadlineMs: 2_500, hardDeadlineMs: 8_000, minPool: 120 }), import('./filters')]);
  const enriched = await enrichSongs(candidates.map((candidate) => candidate.song));
  const enrichedById = new Map(enriched.map((song) => [song.id, song]));
  let ranked = rankCandidates(candidates.map((candidate) => {
    const song = enrichedById.get(candidate.song.id) ?? candidate.song;
    // Classifier-filled fields are inferred, and weigh less than catalogue metadata.
    return { ...candidate, song, classified: classifiedFields(candidate.song, song) };
  }), ctx);
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

/** The catalogue query for a pinned mood (same table the tune intents use). */
function moodPinQuery(mood: Mood, language: string | null): string | null {
  const asIntent: Partial<Record<Mood, TuneIntent>> = { romantic: 'romantic', energetic: 'energetic', chill: 'chill', melancholy: 'heartbreak', devotional: 'devotional' };
  const intent = asIntent[mood];
  return intent ? tuneSearchQuery(intent, language) : null;
}

/** Share of a queue that may go to artists the listener has never played, per discovery mode. */
const DISCOVERY_SHARE = { familiar: 0.05, balanced: 0.2, discover: 0.45 } as const;

export interface NextRecommendationOptions {
  limit?: number;
  excludeIds?: string[];
  excludeKeys?: string[];
  /** v6.5.0 — an active "Tune this queue" intent: reshapes the score, the arc, the language lock and the DJ brief. */
  tune?: TuneIntent | null;
  /** 7.2.0 — cancels the plan and its AI refinement (the player's queue moved on). */
  signal?: AbortSignal;
  /** 7.2.0 — end-to-end budget for the on-device order: from the call to a validated list. */
  deadlineMs?: number;
  /** 7.2.0 — end-to-end budget for the optional AI refinement, counted from the call. */
  aiBudgetMs?: number;
  /** 7.2.0 — the song this stretch will follow in the queue, when it is not the seed (the queue's last entry). */
  previous?: Song | null;
}

/** 7.2.0 — the pipeline's own version, recorded with every continuation (developer breakdown, opt-in telemetry). */
export const PIPELINE_VERSION = '7.2.0';
export function algorithmVersion(): string {
  // The weights part names an owner override while one is applied ("1.2.0+rc7").
  return `${PIPELINE_VERSION}/${activeWeightsVersion()}`;
}

/** Why the AI did not choose a continuation's order. */
export type FallbackReason = 'ai_timeout' | 'ai_unavailable' | 'ai_rejected' | 'deadline' | 'error';

export interface NextSongsPlan {
  /** The validated order to queue now. */
  songs: Song[];
  picker: 'local' | 'ai';
  /** Why the AI did not choose this order; null when it did, or was not asked. */
  fallback: FallbackReason | null;
  latencyMs: number;
  alg: string;
  relaxed: string[];
  discoveryIds: ReadonlySet<string>;
  /** The language the stretch is locked to (null = none known). */
  language: string | null;
  /**
   * Publish this plan's side effects — "why this song" lines, DJ segues and the
   * surfaced-song memory — for the songs the player actually accepted into a
   * still-current queue. Nothing is published before this is called.
   */
  commit(accepted: Song[]): void;
  /**
   * More validated songs for a top-up when the queue is about to run dry
   * before the next plan lands: the ranked reserve, re-validated against the
   * song now at the end of the queue with the same final policy.
   */
  topUp(seedNow: Song, n: number, exclude: { ids: Set<string>; keys: Set<string> }): Song[];
  /** The optional AI refinement of the same stretch: an AI plan, or the reason there is none. */
  refinement: Promise<NextSongsPlan | { rejected: FallbackReason }> | null;
}

export { NEXT_DEADLINE_MS, NEXT_URGENT_DEADLINE_MS };
/** The AI refinement's budget: long enough for the DJ, short of the stretch it would reorder. */
const AI_BUDGET_MS = 24_000;
/** Time kept back from candidate gathering for filtering, ranking, sequencing and validation. */
const RANK_RESERVE_MS = 700;
/** Songs kept in the validated reserve behind a continuation. */
const RESERVE_SIZE = 12;

/** Resolve with `fallback` once `ms` passes or the signal aborts; a late answer is ignored. */
function within<T>(p: Promise<T>, ms: number, fallback: T, signal?: AbortSignal): Promise<{ value: T; late: boolean }> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: T, late: boolean): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve({ value, late });
    };
    const onAbort = (): void => finish(fallback, true);
    const timer = setTimeout(() => finish(fallback, true), Math.max(0, ms));
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
    p.then((v) => finish(v, false), () => finish(fallback, false));
  });
}

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
 * 7.2.0 — a PLAN, local first. The on-device order is built inside one
 * end-to-end deadline (slow optional sources are not waited for past it) and
 * returned at once; the AI DJ's order is a separate, bounded REFINEMENT the
 * caller may apply to the automatic entries that have not started. Nothing is
 * published (reasons, segues, surfaced memory) until the caller commits the
 * songs it accepted. The AI never writes to the queue: whatever it returns
 * goes through stage 10, and a slow, down, wrong or unconfigured AI simply
 * leaves the local order in place.
 */
export async function planNextSongs(seed: Song, ctx: RecommendationContext, options: NextRecommendationOptions = {}): Promise<NextSongsPlan> {
  const t0 = Date.now();
  const alg = algorithmVersion();
  const limit = Math.max(0, Math.min(40, Math.floor(options.limit ?? 8)));
  const signal = options.signal;
  const emptyPlan = (fallback: FallbackReason | null): NextSongsPlan => ({ songs: [], picker: 'local', fallback, latencyMs: Date.now() - t0, alg, relaxed: [], discoveryIds: new Set(), language: seed.language && seed.language !== 'unknown' ? seed.language : null, commit: () => undefined, topUp: () => [], refinement: null });
  if (!limit) return emptyPlan(null);
  const deadlineAt = t0 + Math.max(1_500, options.deadlineMs ?? NEXT_DEADLINE_MS);
  const aiDeadlineAt = t0 + Math.max(0, options.aiBudgetMs ?? AI_BUDGET_MS);
  const left = (): number => Math.max(0, deadlineAt - Date.now());
  const tune = options.tune ?? null;
  /** The song this stretch follows in the queue (the caller's last entry), when that is not the seed. */
  const previous = options.previous ?? null;
  const seedLanguage = seed.language && seed.language !== 'unknown' ? seed.language : null;
  // 8.1.0 — the language policy. 'mix' (the default) lets the listener's other
  // languages into the stretch: the seed's language leads, a song in another
  // language the listener pinned or plays may follow at a cost (the sequencer's
  // 'prefer' policy: never two switches in a row), and a language the listener
  // never chose stays out (the hard filter's allow-list). 'one' is the 7.1 rule.
  const listenerLanguages = [...new Set([...ctx.pinnedLanguages, ...topLanguages(ctx.profile, 3).map((l) => l.id)])].filter((l) => l && l !== 'unknown' && !ctx.mutedLanguages.includes(l));
  // Opt-in per context: a caller that says nothing (tests, the offline evaluation) keeps the 7.1 rule.
  const mix = ctx.queueLanguages === 'mix' && listenerLanguages.filter((l) => l !== seedLanguage).length > 0;
  const allowedLanguages = mix ? new Set<string>([...(seedLanguage ? [seedLanguage] : []), ...listenerLanguages]) : undefined;
  // v7.1.0 — an active tune (or a pinned mood) gathers its own candidates, in the queue's language.
  const intentQuery = tune ? tuneSearchQuery(tune, tune === 'different-language' ? null : seedLanguage) : ctx.moodPin ? moodPinQuery(ctx.moodPin, seedLanguage) : null;
  // 7.2.0 — verified charts, read from the snapshot already in memory (never waited for).
  const trend = trendSignalNow(ctx);
  const nextCtx: RecommendationContext = { ...ctx, seedSong: seed, surface: ctx.surface ?? 'next', intentQuery, trendBonus: trend.bonus, trendLabel: trend.label };
  const mode = effectiveDiscoveryMode(nextCtx);
  const intent = nextCtx.sessionIntent ?? null;
  const library = useLibraryStore.getState();
  let fallback: FallbackReason | null = null;

  // 1 — candidate generation, inside the deadline. The rule modules are lazy,
  // like the sequencer: this engine rides the first-load player store.
  // The gather itself stops waiting for slow optional sources once a useful pool
  // exists (soft deadline) and settles with what it has at the hard one; `within`
  // is only the outer guard.
  const gatherBudget = Math.max(0, left() - RANK_RESERVE_MS);
  const [gathered, { hardFilter, rejectReasonFor, classifiedFields }] = await Promise.all([
    within(
      generateNextCandidates(seed, nextCtx, { signal, softDeadlineMs: Math.min(2_000, gatherBudget / 2), hardDeadlineMs: gatherBudget, minPool: 40 }).catch(() => [] as Candidate[]),
      gatherBudget + 250,
      [] as Candidate[],
      signal,
    ),
    import('./filters'),
  ]);
  if (signal?.aborted) return emptyPlan(null);
  if (gathered.late) fallback = 'deadline';
  const candidates = gathered.value;

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
    // 7.2.0 — soft mutes are a rule at every stage (the DJ's gate and validation included), not only a candidate filter.
    softMuted: ctx.profile.softMuted,
    ...(allowedLanguages ? { allowedLanguages } : {}),
  };
  const filtered = hardFilter(candidates, rules);
  const rejected: RejectedCandidate[] = [...filtered.rejected];

  // 3 — feature extraction: a short foreground window for the classifier, never past the deadline.
  const enriched = await enrichSongs(filtered.admitted.map((candidate) => candidate.song), { waitMs: Math.min(1_800, Math.max(0, left() - RANK_RESERVE_MS)) });
  const enrichedById = new Map(enriched.map((song) => [song.id, song]));

  // 4–8 — scoring, diversity, session adjustment, exploration tuning, ranking.
  let ranked = rankCandidates(
    filtered.admitted.map((candidate) => {
      const song = enrichedById.get(candidate.song.id) ?? candidate.song;
      return { ...candidate, song, classified: classifiedFields(candidate.song, song) };
    }),
    nextCtx,
    (dropped) => rejected.push({ song: dropped.candidate.song, reason: 'low-score', stage: 'rank' }),
  );
  // v6.5.2 — the AI re-rank and the AI DJ both order the same pool; when the
  // DJ is on, it is the AI voice for this stretch. The re-rank waits only
  // inside what is left of the deadline.
  const djOn = aiDjEnabled();
  if (!djOn && useSettingsStore.getState().aiAssist && ranked.length >= 4 && left() > RANK_RESERVE_MS) {
    const blended = await within(blendAi(ranked, nextCtx), left() - RANK_RESERVE_MS / 2, ranked, signal);
    ranked = blended.value;
    if (blended.late && !signal?.aborted) fallback = fallback ?? 'ai_timeout';
  }
  if (signal?.aborted) return emptyPlan(null);
  const seedLang = seedLanguage;
  if (tune) {
    // v6.5.0 — the on-device half of a tune: a deterministic nudge per song
    // so the intent holds even when the DJ is unavailable.
    ranked = ranked.map((item) => ({ ...item, score: item.score + tuneScoreAdjust(item.candidate.song, tune, seedLang) })).sort((a, b) => b.score - a.score);
  }
  const orderedPool: Song[] = ranked.map((item) => item.candidate.song);

  // 9 — queue sequencing. Lazy: the sequencer and the session-context reader are only needed once a queue is extended.
  const [{ sequenceSongs, arcErrorOf }, { readListenerEnergy }, { validateSequence }] = await Promise.all([import('./sequencer'), import('@/services/ai/sessionContext'), import('./validation')]);
  // A live skip streak outranks the slower history read: come up and re-anchor now.
  const shape = (tune && tuneShape(tune)) || (intent && intent.skipStreak >= 2 ? 'lift' : shapeFor(readListenerEnergy(ctx.history, ctx.hour)));
  const sureIds = new Set([...ctx.favorites.map((s) => s.id), ...ctx.history.slice(0, 60).map((e) => e.song.id)]);
  // Discovery = an artist this listener has never played (or an explore-source pick).
  const frame = buildScoringFrame(nextCtx);
  const discoveryIds = new Set(
    ranked
      // A song fetched FOR the listener's stated intent is the request itself, not a discovery to ration.
      .filter((item) => item.candidate.source !== 'intent')
      .filter((item) => item.candidate.source === 'explore' || !frame.knownArtists.has((item.candidate.song.artists[0]?.name ?? '').trim().toLowerCase()))
      .map((item) => item.candidate.song.id),
  );
  // Language rule: the queue speaks the seed's language. "Switch language"
  // moves the lock to another language the listener plays — the queue still speaks ONE language.
  const switchTo = tune === 'different-language'
    ? ctx.pinnedLanguages.find((l) => l !== seedLang) ?? orderedPool.map((s) => s.language).find((l) => l && l !== 'unknown' && l !== seedLang) ?? null
    : null;
  const lock = switchTo ?? seedLang;
  const otherLanguages = (mix ? listenerLanguages : ctx.pinnedLanguages).filter((l) => l !== lock);
  const languagePolicy: 'lock' | 'prefer' = mix && !switchTo ? 'prefer' : 'lock';
  const discoveryShare = Math.max(0, Math.min(0.5, (tune === 'surprise' ? DISCOVERY_SHARE.discover : DISCOVERY_SHARE[mode]) + (intent ? intent.discoveryAppetite * 0.15 : 0)));
  const arc = sequenceSongs(orderedPool.slice(0, 40), { seed, shape, limit, language: lock, languagePolicy, otherLanguages, discovery: discoveryShare, discoveryIds, sureIds, recent: ctx.history.slice(0, 3).map((e) => e.song) });

  // 10 — validation. The arc first, then the rest of the ranked pool as the
  // reserve a short or language-locked arc is topped up from.
  const familiarLanguages = [...new Set([...ctx.pinnedLanguages, ...topLanguages(ctx.profile, 3).map((l) => l.id)])];
  // 7.2.0 — the final policy, for every order that ships (local, AI, reserve top-up):
  // the discovery allocation and the familiar opening are enforced here too.
  // Under 'prefer' the sequencer already priced every detour; validation keeps the allow-list (in `rules`) and drops the lock.
  const validateOptions: ValidateOptions = { ...rules, limit, lockLanguage: languagePolicy === 'lock' ? lock : null, leadLanguage: languagePolicy === 'prefer' ? lock : null, familiarLanguages, discoveryIds, discoveryShare, previous };
  const arcIds = new Set(arc.songs.map((s) => s.song.id));
  const local = validateSequence([...arc.songs.map((s) => s.song), ...orderedPool.filter((s) => !arcIds.has(s.id))], validateOptions);
  const songs = local.songs;
  const trace: DebugTrace = { mode, shape, lock, languagePolicy, discoveryShare, intent: intent ? { skipStreak: intent.skipStreak, completionStreak: intent.completionStreak, discoveryAppetite: intent.discoveryAppetite, energySteer: intent.energySteer } : null, stages: { candidates: candidates.length, admitted: filtered.admitted.length, ranked: ranked.length, sequenced: arc.songs.length, validated: songs.length }, relaxed: [...new Set([...(arc.relaxed ?? []), ...local.relaxed])], repairs: local.repairs };
  publishDebug(ranked, songs, 'local', { trace, rejected: [...rejected, ...local.rejected] });

  const shipped = new Set(songs.map((s) => s.id));
  const reservePool = orderedPool.filter((s) => !shipped.has(s.id)).slice(0, RESERVE_SIZE * 2);
  const committed = new Set<string>();
  const publishFor = (accepted: Song[], whyFromArc: boolean): void => {
    const ids = new Set(accepted.map((s) => s.id).filter((id) => !committed.has(id)));
    if (!ids.size) return;
    for (const id of ids) committed.add(id);
    // Arc reasons are more specific than scorer reasons; let them win.
    if (whyFromArc) useReasonStore.getState().setReasons(arc.songs.filter((s) => s.why && ids.has(s.song.id)).map((s) => [s.song.id, s.why]));
    publishReasons(ranked.filter((item) => ids.has(item.candidate.song.id)));
  };
  const topUp = (seedNow: Song, n: number, exclude: { ids: Set<string>; keys: Set<string> }): Song[] => {
    if (n <= 0) return [];
    // The same final policy as the shipped order, against the song now at the end of the queue.
    const pool = reservePool.filter((s) => !exclude.ids.has(s.id) && !exclude.keys.has(songKey(s)));
    return validateSequence(pool, { ...validateOptions, seed: seedNow, limit: Math.min(n, RESERVE_SIZE), queuedIds: new Set([...(rules.queuedIds ?? []), ...exclude.ids]), queuedKeys: new Set([...(rules.queuedKeys ?? []), ...exclude.keys]) }).songs;
  };
  const plan: NextSongsPlan = {
    songs,
    picker: 'local',
    fallback,
    latencyMs: Date.now() - t0,
    alg,
    relaxed: [...new Set([...(arc.relaxed ?? []), ...local.relaxed])],
    discoveryIds,
    language: lock,
    commit: (accepted) => publishFor(accepted, true),
    topUp,
    refinement: null,
  };

  // 9b — the AI DJ gets a bounded, optional say over the ORDER of the admitted
  // pool, and may propose a few songs from outside it. It is a refinement: the
  // local order above is already usable.
  if (djOn && songs.length >= 3 && aiDeadlineAt - Date.now() > 1_500) {
    plan.refinement = (async (): Promise<NextSongsPlan | { rejected: FallbackReason }> => {
      const dj = await import('@/services/ai/dj');
      // v6.5.0 — a rotating slice of the ranked pool (top ranks always, the rest sampled).
      const pool = dj.samplePool(orderedPool.slice(0, 40), 10, 30);
      // Each proposal is verified in the catalogue and must pass the same rules as everything else.
      // Under the mix policy a proposal may be in any allowed language (the hard filter's allow-list checks it).
      const gate = { language: languagePolicy === 'lock' ? lock : null, admit: (song: Song) => rejectReasonFor(song, rules) === null };
      const controller = new AbortController();
      const cancel = (): void => controller.abort();
      if (signal?.aborted) return { rejected: 'ai_unavailable' };
      signal?.addEventListener('abort', cancel, { once: true });
      const timer = setTimeout(cancel, Math.max(0, aiDeadlineAt - Date.now()));
      let set: Awaited<ReturnType<typeof dj.djSequence>>;
      try {
        set = await dj.djSequence(seed, nextCtx, pool, limit, controller.signal, { shape, discover: true, gate, ...(tune ? { tune: tunePromptHint(tune) } : {}) });
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
      }
      if (!set || set.picks.length < Math.min(3, limit)) {
        const outcome = typeof dj.lastDjOutcome === 'function' ? dj.lastDjOutcome() : 'unavailable';
        return { rejected: outcome === 'timeout' ? 'ai_timeout' : outcome === 'empty' ? 'ai_rejected' : outcome === 'error' ? 'error' : 'ai_unavailable' };
      }
      const used = new Set<string>();
      const proposed: Song[] = [];
      for (const p of set.picks) if (!used.has(p.song.id)) { used.add(p.song.id); proposed.push(p.song); }
      for (const s of songs) if (!used.has(s.id)) { used.add(s.id); proposed.push(s); }
      // The DJ's order goes through the same validation as the local one, and
      // is accepted only when it still keeps the arc about as tight (a tune
      // relaxes the tolerance: the listener asked for a change of direction).
      const checked = validateSequence(proposed, validateOptions);
      // 7.2.0 — count the DJ's OWN picks that survived: local songs filling the
      // gaps behind a rejected answer used to make it look accepted.
      const djIds = new Set(set.picks.map((p) => p.song.id));
      const survived = checked.songs.filter((s) => djIds.has(s.id)).length;
      if (survived < Math.min(3, limit) || arcErrorOf(checked.songs, seed, shape) > arcErrorOf(songs, seed, shape) + (tune ? 0.2 : 0.08)) return { rejected: 'ai_rejected' };
      publishDebug(ranked, checked.songs, 'ai', {
        trace: { ...trace, stages: { ...trace.stages, validated: checked.songs.length }, relaxed: checked.relaxed, repairs: checked.repairs },
        rejected: [...rejected, ...checked.rejected],
        confidence: new Map(set.picks.filter((p) => typeof p.confidence === 'number').map((p) => [p.song.id, p.confidence as number])),
        discovered: new Set(set.picks.filter((p) => p.discovered).map((p) => p.song.id)),
      });
      const djSet = set;
      return {
        ...plan,
        songs: checked.songs,
        picker: 'ai',
        discoveryIds,
        fallback: null,
        latencyMs: Date.now() - t0,
        relaxed: [...checked.relaxed],
        commit: (accepted) => {
          // The DJ's own lines first (they overwrite), then scorer lines fill any gaps.
          if (typeof dj.commitDjSet === 'function') dj.commitDjSet(djSet, accepted);
          publishFor(accepted, false);
        },
        refinement: null,
      };
    })().catch((): { rejected: FallbackReason } => ({ rejected: 'error' }));
  }
  return plan;
}

/**
 * The whole continuation as one list, for callers that are not the live
 * queue (radio start, playlist continuation, tests): the local plan, replaced
 * by the AI refinement when that arrives and passes validation. Side effects
 * are committed for the returned songs.
 */
export async function recommendNextSongs(seed: Song, ctx: RecommendationContext, options: NextRecommendationOptions = {}): Promise<Song[]> {
  const plan = await planNextSongs(seed, ctx, options);
  let chosen = plan;
  if (plan.refinement) {
    const refined = await plan.refinement;
    if ('songs' in refined) chosen = refined;
  }
  chosen.commit(chosen.songs);
  return chosen.songs;
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

/** Listener switches (AI in recommendations, AI DJ) AND the owner flag (read from the cached config; a missing flag means on). */
function aiDjEnabled(): boolean {
  const settings = useSettingsStore.getState();
  if (!settings.aiAssist || !settings.aiDj) return false;
  const flags = queryClient.getQueryData<Record<string, boolean>>(['feature-flags']);
  return flags?.aiDj !== false;
}

export async function startRadioRecommendations(seed: Song, ctx: RecommendationContext, limit = 30): Promise<Song[]> {
  return recommendNextSongs(seed, { ...ctx, surface: 'radio', intensity: Math.max(ctx.intensity, 0.65) }, { limit, excludeIds: [seed.id] });
}

export async function continuePlaylist(seed: Song, ctx: RecommendationContext, options: NextRecommendationOptions = {}): Promise<Song[]> {
  return recommendNextSongs(seed, { ...ctx, surface: 'playlist' }, options);
}
