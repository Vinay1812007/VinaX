import type { Song } from '../../src/types';
import type { EvalFixture } from '../fixtures';
import { ai, resetAi, resetCatalogue, type Behaviour } from './mocks';
import { addViolations, eligible, leadName, noViolations, violationsOf, workKey, type RuleContext, type Violations } from './rules';

/**
 * One sitting, as the player would run it: plan a stretch of five, queue it,
 * let it play down to the second-to-last song, plan the next stretch with
 * everything queued excluded — four times over.
 *
 * The harness only ever calls the two public entry points, so it keeps
 * working when the modules underneath them change:
 *   planNextSongs      (7.2: a plan now, an AI refinement later)
 *   recommendNextSongs (the whole continuation as one list — the baseline's only entry point)
 */
export const LIMIT = 5;
/** Share of a stretch open to never-played artists, per mode (docs/recommendations.md). */
export const DISCOVERY_SHARE = { familiar: 0.05, balanced: 0.2, discover: 0.45 } as const;
/** Nothing in a fixture should take this long; a run that does is reported, not awaited forever. */
export const SAFETY_CAP_MS = 20_000;

export interface PlanLike {
  songs: Song[];
  picker: string;
  fallback: string | null;
  latencyMs: number;
  alg: string;
  relaxed: string[];
  discoveryIds: ReadonlySet<string>;
  language: string | null;
  refinement: Promise<PlanLike | { rejected: string }> | null;
}

export interface EngineLike {
  planNextSongs?: (seed: Song, ctx: unknown, options: unknown) => Promise<PlanLike>;
  recommendNextSongs: (seed: Song, ctx: unknown, options: unknown) => Promise<Song[]>;
  algorithmVersion?: () => string;
}

export interface BatchRecord {
  fixture: string;
  salt: number;
  batch: number;
  n: number;
  ids: string[];
  picker: string;
  fallback: string | null;
  refinement: string;
  queueReadyMs: number;
  finalMs: number;
  engineLatencyMs: number | null;
  relaxed: string[];
  violations: Violations;
  violationsQueueReady: Violations;
  /** Off-language songs the documented relaxation covers (fewer than three in-language candidates were left). */
  offLanguageExcused: number;
  /** Fewer than three in-language candidates were left: the documented relaxation applies to this continuation. */
  lockStarved: boolean;
  discovery: number;
  /** The pipeline's own count, when it publishes one: a different definition, not a different pool. */
  engineDiscovery: number | null;
  discoveryCap: number;
  familiarAvailable: number;
  /** Lead artists still eligible when this batch was planned (an unavoidable repeat has none other). */
  eligibleLeads: string[];
  slot1Discovery: boolean;
  slot2Discovery: boolean;
  distinctArtists: number;
  aiSongsShipped: number;
  timedOut: boolean;
}

export interface SessionRecord {
  fixture: string;
  salt: number;
  batches: BatchRecord[];
  queueIds: string[];
  /** Pairs of neighbours in the assembled queue (the seed counts as the first). */
  sameLeadBackToBack: number;
  /** Of those, the ones where another lead artist was still eligible. */
  sameLeadBackToBackAvoidable: number;
  sameLeadAtBatchBoundary: number;
  sameLeadWithinThree: number;
  sameIdentityBackToBack: number;
  repeatedIdentity: number;
  distinctArtistsInSession: number;
  songsInSession: number;
}

export interface RunEnv {
  now: number;
  /** The tree's own canonical identity — what the player passes as `excludeKeys`. */
  songKey: (s: Song) => string;
  /** Put this fixture's settings, library and profile into the tree's stores. */
  applyFixture: (fixture: EvalFixture) => void;
  /** Build the recommendation context the player would build. */
  buildContext: (fixture: EvalFixture, salt: number, played: Song[]) => unknown;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

async function withCap<T>(p: Promise<T>, ms: number): Promise<{ value: T | null; timedOut: boolean }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const capped = new Promise<{ value: null; timedOut: true }>((resolve) => {
    timer = setTimeout(() => resolve({ value: null, timedOut: true }), ms);
  });
  const result = await Promise.race([p.then((value) => ({ value, timedOut: false as const })), capped]);
  clearTimeout(timer);
  return result;
}

export interface BatchOutcome {
  queueReady: Song[];
  final: Song[];
  /** What the pipeline itself counted as a discovery (7.2 plans only). */
  discoveryIds: ReadonlySet<string> | null;
  picker: string;
  fallback: string | null;
  refinement: string;
  queueReadyMs: number;
  finalMs: number;
  engineLatencyMs: number | null;
  relaxed: string[];
  timedOut: boolean;
}

/** One continuation, through whichever entry point the tree offers. */
export async function planOnce(engine: EngineLike, seed: Song, ctx: unknown, options: Record<string, unknown>, capMs = SAFETY_CAP_MS): Promise<BatchOutcome> {
  const controller = new AbortController();
  const started = performance.now();
  if (typeof engine.planNextSongs === 'function') {
    const planned = await withCap(engine.planNextSongs(seed, ctx, { ...options, signal: controller.signal }), capMs);
    const queueReadyMs = performance.now() - started;
    const plan = planned.value;
    if (!plan) {
      controller.abort();
      return { queueReady: [], final: [], discoveryIds: null, picker: 'none', fallback: 'timeout', refinement: 'none', queueReadyMs, finalMs: queueReadyMs, engineLatencyMs: null, relaxed: [], timedOut: true };
    }
    let final = plan.songs;
    let picker = plan.picker;
    let refinement = 'none';
    let finalMs = queueReadyMs;
    if (plan.refinement) {
      const refined = await withCap(plan.refinement, Math.max(0, capMs - (performance.now() - started)));
      finalMs = performance.now() - started;
      if (!refined.value) {
        refinement = 'unresolved';
        controller.abort();
      } else if ('songs' in refined.value) {
        refinement = 'applied';
        final = refined.value.songs;
        picker = 'ai';
      } else {
        refinement = refined.value.rejected;
      }
    }
    return { queueReady: plan.songs, final, discoveryIds: plan.discoveryIds, picker, fallback: plan.fallback, refinement, queueReadyMs, finalMs, engineLatencyMs: plan.latencyMs, relaxed: [...plan.relaxed], timedOut: false };
  }
  // The baseline: one call that returns the whole continuation, AI included.
  const out = await withCap(engine.recommendNextSongs(seed, ctx, options), capMs);
  const elapsed = performance.now() - started;
  const songs = out.value ?? [];
  const aiShipped = songs.filter((s) => ai.proposed.has(s.id)).length;
  return {
    queueReady: songs,
    final: songs,
    discoveryIds: null,
    picker: out.timedOut ? 'none' : aiShipped >= Math.min(3, LIMIT) ? 'ai' : 'local',
    fallback: out.timedOut ? 'timeout' : null,
    refinement: 'n/a',
    queueReadyMs: elapsed,
    finalMs: elapsed,
    engineLatencyMs: null,
    relaxed: [],
    timedOut: out.timedOut,
  };
}

/** Put a fixture's catalogue and AI script into the mocks. */
export function armFixture(fixture: EvalFixture, seedId: string, over: { suggestions?: Behaviour; search?: Behaviour; searchNeverAfter?: number | null; slow?: boolean; ai?: EvalFixture['ai'] } = {}): void {
  resetCatalogue({
    seedId,
    related: fixture.related,
    search: fixture.search,
    suggestions: over.suggestions ?? fixture.outage?.suggestions ?? 'ok',
    searchBehaviour: over.search ?? fixture.outage?.search ?? 'ok',
    searchNeverAfter: over.searchNeverAfter ?? null,
    slow: over.slow ?? false,
  });
  resetAi(over.ai ?? fixture.ai);
}

function ruleContext(fixture: EvalFixture, queue: Song[], played: Song[]): RuleContext {
  // "Recently played" is the documented window: the profile's recent ids, or
  // the identity of any of the LAST TWENTY plays — this sitting's plays
  // included, and they push older ones out of it (docs/recommendations.md).
  const recentIds = new Set<string>(fixture.profile.recentSongIds);
  const recentKeys = new Set<string>([...[...played].reverse(), ...fixture.history.map((e) => e.song)].slice(0, 20).map((s) => workKey(s)));
  return {
    kidMode: fixture.kidMode,
    mutedLanguages: new Set(fixture.mutedLanguages),
    hiddenArtists: new Set(fixture.hiddenArtists.map((n) => leadName({ artists: [{ id: '', name: n }], subtitle: n } as Song))),
    hiddenSongIds: new Set(fixture.hiddenSongIds),
    softMuted: new Set(Object.keys(fixture.profile.softMuted).map((n) => leadName({ artists: [{ id: '', name: n }], subtitle: n } as Song))),
    recentIds,
    recentKeys,
    queuedIds: new Set(queue.map((s) => s.id)),
    queuedKeys: new Set(queue.map((s) => workKey(s))),
    lock: fixture.seed.language && fixture.seed.language !== 'unknown' ? fixture.seed.language : null,
  };
}

/** Artists this listener has played — the yardstick for "a discovery". */
function knownArtists(fixture: EvalFixture, played: Song[]): Set<string> {
  const known = new Set<string>();
  for (const a of Object.values(fixture.profile.artists)) known.add(leadName({ artists: [{ id: '', name: a.name }], subtitle: a.name } as Song));
  for (const e of fixture.history) known.add(leadName(e.song));
  for (const s of [...fixture.favorites, ...played]) known.add(leadName(s));
  known.delete('');
  return known;
}

/** One sitting of `fixture.batches` continuations. */
export async function runSession(engine: EngineLike, fixture: EvalFixture, salt: number, env: RunEnv, options: Record<string, unknown> = {}): Promise<SessionRecord> {
  env.applyFixture(fixture);
  const queue: Song[] = [fixture.seed];
  const played: Song[] = [];
  const batches: BatchRecord[] = [];
  const poolAll = [...fixture.related, ...fixture.search];
  const appetite = fixture.sessionIntent?.discoveryAppetite ?? 0;
  const share = clamp(DISCOVERY_SHARE[fixture.discoveryMode] + appetite * 0.15, 0, 0.5);

  for (let b = 0; b < fixture.batches; b += 1) {
    // The player asks when one song is left after the current one. Each
    // continuation starts from clean stores and an empty provider cache: in a
    // real sitting these are minutes apart, well past the cache's own life.
    env.applyFixture(fixture);
    const seed = queue.length >= 2 ? queue[queue.length - 2] : queue[0];
    armFixture(fixture, seed.id);
    const ctx = env.buildContext(fixture, salt, played);
    const outcome = await planOnce(engine, seed, ctx, {
      ...options,
      limit: LIMIT,
      excludeIds: queue.map((s) => s.id),
      excludeKeys: queue.map((s) => env.songKey(s)),
      // The player appends after the last queued song, so that is the hand-off
      // the no-repeat-artist rule has to judge (7.2).
      previous: queue[queue.length - 1],
    });
    const rc = ruleContext(fixture, queue, played);
    const known = knownArtists(fixture, played);
    const isDiscovery = (s: Song): boolean => !known.has(leadName(s));
    const pool = eligible(poolAll, rc);
    const familiarAvailable = pool.filter((s) => !isDiscovery(s)).length;
    const inLanguage = pool.length;
    const violations = violationsOf(outcome.final, rc);
    batches.push({
      fixture: fixture.id,
      salt,
      batch: b,
      n: outcome.final.length,
      ids: outcome.final.map((s) => s.id),
      picker: outcome.picker,
      fallback: outcome.fallback,
      refinement: outcome.refinement,
      queueReadyMs: outcome.queueReadyMs,
      finalMs: outcome.finalMs,
      engineLatencyMs: outcome.engineLatencyMs,
      relaxed: outcome.relaxed,
      violations,
      violationsQueueReady: violationsOf(outcome.queueReady, rc),
      // The lock bends only when fewer than three in-language candidates are left (docs/recommendations.md).
      offLanguageExcused: inLanguage < 3 ? violations['off-language'] : 0,
      lockStarved: inLanguage < 3,
      discovery: outcome.final.filter(isDiscovery).length,
      engineDiscovery: outcome.discoveryIds ? outcome.final.filter((s) => outcome.discoveryIds!.has(s.id)).length : null,
      discoveryCap: Math.floor(share * Math.max(1, outcome.final.length) + 0.5),
      familiarAvailable,
      // 7.2 — which lead artists were still eligible when this batch was
      // planned, so a repeat can be told from a forced one (the fixtures are
      // small, and late batches run the pool dry).
      eligibleLeads: [...new Set(pool.map(leadName).filter(Boolean))],
      slot1Discovery: !!outcome.final[0] && isDiscovery(outcome.final[0]),
      slot2Discovery: outcome.final.length >= 4 && !!outcome.final[1] && isDiscovery(outcome.final[1]),
      distinctArtists: new Set(outcome.final.map(leadName)).size,
      aiSongsShipped: outcome.final.filter((s) => ai.proposed.has(s.id)).length,
      timedOut: outcome.timedOut,
    });
    if (!outcome.final.length) break;
    queue.push(...outcome.final);
    // By the time the next stretch is asked for, everything before that stretch's seed has played.
    played.length = 0;
    played.push(...queue.slice(0, Math.max(0, queue.length - 2)));
  }

  // Repetition over the whole sitting, as the listener hears it.
  const boundaries = new Set<number>();
  let at = 1;
  for (const rec of batches) {
    boundaries.add(at);
    at += rec.n;
  }
  let sameLeadBackToBack = 0;
  let sameLeadBackToBackAvoidable = 0;
  let sameLeadAtBatchBoundary = 0;
  let sameLeadWithinThree = 0;
  let sameIdentityBackToBack = 0;
  let repeatedIdentity = 0;
  const seenKeys = new Set<string>([workKey(queue[0])]);
  const batchAt = new Map<number, BatchRecord>();
  let cursor = 1;
  for (const rec of batches) {
    for (let k = 0; k < rec.n; k += 1) batchAt.set(cursor + k, rec);
    cursor += rec.n;
  }
  for (let i = 1; i < queue.length; i += 1) {
    const lead = leadName(queue[i]);
    if (lead && lead === leadName(queue[i - 1])) {
      sameLeadBackToBack += 1;
      if (boundaries.has(i)) sameLeadAtBatchBoundary += 1;
      // Avoidable when another lead artist was still eligible for that batch.
      const leads = batchAt.get(i)?.eligibleLeads ?? [];
      if (leads.some((l) => l && l !== lead)) sameLeadBackToBackAvoidable += 1;
    } else if (lead && queue.slice(Math.max(0, i - 3), i).some((s) => leadName(s) === lead)) {
      sameLeadWithinThree += 1;
    }
    const key = workKey(queue[i]);
    if (key === workKey(queue[i - 1])) sameIdentityBackToBack += 1;
    if (seenKeys.has(key)) repeatedIdentity += 1;
    seenKeys.add(key);
  }
  return {
    fixture: fixture.id,
    salt,
    batches,
    queueIds: queue.map((s) => s.id),
    sameLeadBackToBack,
    sameLeadBackToBackAvoidable,
    sameLeadAtBatchBoundary,
    sameLeadWithinThree,
    sameIdentityBackToBack,
    repeatedIdentity,
    distinctArtistsInSession: new Set(queue.slice(1).map(leadName)).size,
    songsInSession: queue.length - 1,
  };
}

export const emptyViolations = (): Violations => noViolations();
export const mergeViolations = addViolations;
