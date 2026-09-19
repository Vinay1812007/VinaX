import { isCompletion, isEarlyLeave, onPlaybackEvent, playThreshold, type PlaybackEndReason, type PlaybackEvent } from '@/services/playback/session';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import { claimExposure, exposureOf, loadRecExperiments } from '@/features/experiments/recExperiment';
import { consented, trackStructured, type TelemetryMeta } from './telemetry';

/**
 * 7.2.0 — recommendation outcomes, opt-in only.
 *
 * Two structured events, sent through the consent-gated usage sender
 * (./telemetry.ts) and nothing else. Neither carries a song, a song id, a
 * queue, a batch number or any identifier beyond what every usage event
 * already carries; the Worker whitelists and clips `meta` and keeps
 * aggregates.
 *
 *   rec_served   once per automatic continuation, when its FINAL picker is
 *                known: at once when no AI refinement is pending, otherwise
 *                when the matching `refined` event arrives, or after
 *                REFINE_WAIT_MS (the refinement never settled).
 *                meta = { alg, picker, fallback, latencyMs, n, discovery,
 *                         languageViolations, distinctArtists, relaxed, exp }
 *   rec_outcome  when a playback instance of an AUTOMATIC queue entry ends.
 *                meta = { alg, picker, pos, heardSec, durationSec, outcome,
 *                         liked, exp }
 *
 * `outcome` reads the playback session's own thresholds (heard seconds, never
 * the playhead): complete = a natural end with ≥ 70 % heard (≥ 30 s when the
 * length is unknown); early_skip = a manual skip before the PLAY counted;
 * skip = a manual skip after it, with < 30 % heard; partial = everything else
 * (a skip past 30 %, a tap on another song, a cleared queue). Failed playback
 * judges nothing and sends nothing. One outcome per run: a repeat-one loop of
 * an automatic song reports once.
 *
 * When an AI refinement replaced the stretch, `n` counts the songs it placed,
 * `distinctArtists` is re-counted from the queue entries of that continuation
 * as they stand after the refinement, and `discovery`, `languageViolations`
 * and `relaxed` are null: the player's `refined` event does not measure them
 * for the AI's order (it passed the same validation as the local one).
 * `latencyMs` is always the queue-ready latency — from the plan call to a
 * queueable order — whoever picked. `exp` is the continuation's exposure map
 * (features/experiments/recExperiment.ts), including an applied owner
 * tuning rollout under `rec-config`.
 *
 * Volume. A token bucket (REC_BUCKET events, one more every REC_REFILL_MS)
 * feeds a small outbox; beyond REC_OUTBOX_CAP waiting events, or
 * REC_SESSION_CAP events in one session, new events are dropped. A long
 * session, or a burst of skips, cannot flood the endpoint.
 */
export type RecPicker = 'local' | 'ai' | 'reserve';
export type RecFallback = null | 'ai_timeout' | 'ai_unavailable' | 'ai_rejected' | 'deadline' | 'error';
export type RecOutcome = 'complete' | 'skip' | 'early_skip' | 'partial';

/** Longer than the engine's AI budget (24 s): a refinement that has not settled by then never will. */
export const REFINE_WAIT_MS = 35_000;
export const REC_BUCKET = 12;
export const REC_REFILL_MS = 5_000;
export const REC_OUTBOX_CAP = 40;
export const REC_SESSION_CAP = 400;

const FALLBACKS = new Set(['ai_timeout', 'ai_unavailable', 'ai_rejected', 'deadline', 'error']);
const fallbackOf = (f: string | null | undefined): RecFallback => (f == null ? null : FALLBACKS.has(f) ? (f as RecFallback) : 'error');
const pickerOf = (p: string): RecPicker => (p === 'ai' || p === 'reserve' ? p : 'local');
const whole = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0);

/**
 * How a playback instance of an automatic entry went, by the session's
 * thresholds (services/playback/session.ts). Null for failed playback.
 */
export function classifyOutcome(heardSec: number, durationSec: number, reason: PlaybackEndReason): RecOutcome | null {
  if (reason === 'failed') return null;
  if ((reason === 'ended' || reason === 'repeat') && isCompletion(heardSec, durationSec)) return 'complete';
  if (reason === 'manual-skip') {
    if (heardSec < playThreshold(durationSec)) return 'early_skip';
    if (isEarlyLeave(heardSec, durationSec)) return 'skip';
  }
  return 'partial';
}

type Served = Extract<PlaybackEvent, { kind: 'served' }>;
type Refined = Extract<PlaybackEvent, { kind: 'refined' }>;
type Ended = Extract<PlaybackEvent, { kind: 'end' }>;

interface PendingBatch {
  served: Served;
  exp: Record<string, string>;
  timer: ReturnType<typeof setTimeout>;
}

const pendingBatches = new Map<number, PendingBatch>();
const outbox: Array<{ type: string; meta: TelemetryMeta }> = [];
const reportedRuns = new Set<string>();
let tokens = REC_BUCKET;
let lastRefill = 0;
let drainTimer: ReturnType<typeof setTimeout> | null = null;
let sentThisSession = 0;
let stop: (() => void) | null = null;

function refill(): void {
  const now = Date.now();
  const steps = Math.floor((now - lastRefill) / REC_REFILL_MS);
  if (steps > 0) {
    tokens = Math.min(REC_BUCKET, tokens + steps);
    lastRefill += steps * REC_REFILL_MS;
  }
}

function pump(): void {
  if (!consented()) {
    outbox.length = 0;
    return;
  }
  refill();
  while (tokens > 0 && outbox.length) {
    tokens -= 1;
    const next = outbox.shift()!;
    void trackStructured(next.type, next.meta);
  }
  if (outbox.length && drainTimer == null) {
    drainTimer = setTimeout(() => {
      drainTimer = null;
      pump();
    }, REC_REFILL_MS);
  }
}

function enqueue(type: 'rec_served' | 'rec_outcome', meta: TelemetryMeta): void {
  if (!consented()) return;
  if (sentThisSession >= REC_SESSION_CAP || outbox.length >= REC_OUTBOX_CAP) return;
  sentThisSession += 1;
  outbox.push({ type, meta });
  pump();
}

/** Distinct lead artists among the queue entries of one continuation (the player's own count, re-taken after a refinement). */
function distinctArtistsOfBatch(batch: number): number | null {
  const player = usePlayerStore.getState();
  const leads = new Set<string>();
  let found = 0;
  for (const s of player.queue) {
    if (player.autoMeta(s.id)?.batch !== batch) continue;
    found += 1;
    const lead = (s.artists[0]?.name ?? s.subtitle ?? '').trim().toLowerCase();
    if (lead) leads.add(lead);
  }
  return found ? leads.size : null;
}

function sendServed(served: Served, exp: Record<string, string>, refined: Refined | null, timedOut: boolean): void {
  const aiApplied = !!refined?.applied;
  const fallback: RecFallback = aiApplied
    ? null
    : refined
      ? fallbackOf(refined.fallback) ?? fallbackOf(served.fallback)
      : timedOut
        ? fallbackOf(served.fallback) ?? 'ai_timeout'
        : fallbackOf(served.fallback);
  enqueue('rec_served', {
    alg: served.alg,
    picker: aiApplied ? 'ai' : pickerOf(served.picker),
    fallback,
    latencyMs: whole(served.latencyMs),
    n: whole(aiApplied ? refined!.n : served.n),
    discovery: aiApplied ? null : whole(served.discovery),
    languageViolations: aiApplied ? null : whole(served.languageViolations),
    distinctArtists: aiApplied ? distinctArtistsOfBatch(served.batch) : whole(served.distinctArtists),
    relaxed: aiApplied ? null : served.relaxed.slice(0, 4).map((r) => String(r).slice(0, 24)),
    exp,
  });
}

function onServed(e: Served): void {
  // A listener who opted in mid-session: read the experiment config now (once).
  void loadRecExperiments();
  const exp = claimExposure(e.batch, { reserve: e.picker === 'reserve' });
  if (!e.refinementPending) {
    sendServed(e, exp, null, false);
    return;
  }
  const timer = setTimeout(() => {
    const p = pendingBatches.get(e.batch);
    if (!p) return;
    pendingBatches.delete(e.batch);
    sendServed(p.served, p.exp, null, true);
  }, REFINE_WAIT_MS);
  pendingBatches.set(e.batch, { served: e, exp, timer });
}

function onRefined(e: Refined): void {
  const p = pendingBatches.get(e.batch);
  if (!p) return;
  clearTimeout(p.timer);
  pendingBatches.delete(e.batch);
  sendServed(p.served, p.exp, e, false);
}

function onEnded(e: Ended): void {
  if (!e.auto) return;
  if (reportedRuns.has(e.run.id)) return;
  const outcome = classifyOutcome(e.heardSec, e.durationSec, e.reason);
  if (!outcome) return;
  reportedRuns.add(e.run.id);
  if (reportedRuns.size > 500) reportedRuns.delete(reportedRuns.values().next().value as string);
  enqueue('rec_outcome', {
    alg: e.auto.alg,
    picker: pickerOf(e.auto.picker),
    pos: whole(e.auto.pos),
    heardSec: whole(e.heardSec),
    durationSec: whole(e.durationSec),
    outcome,
    liked: useLibraryStore.getState().isFavorite(e.song.id),
    exp: exposureOf(e.auto.batch),
  });
}

/**
 * Subscribe to the playback event bus. Idempotent; returns the teardown.
 * Consent is read on every event, so opting out stops sending at once.
 */
export function initRecTelemetry(): () => void {
  if (stop) return stop;
  tokens = REC_BUCKET;
  lastRefill = Date.now();
  if (consented()) void loadRecExperiments();
  const unsubscribe = onPlaybackEvent((e) => {
    if (!consented()) return;
    if (e.kind === 'served') onServed(e);
    else if (e.kind === 'refined') onRefined(e);
    else if (e.kind === 'end') onEnded(e);
  });
  stop = () => {
    unsubscribe();
    for (const p of pendingBatches.values()) clearTimeout(p.timer);
    pendingBatches.clear();
    if (drainTimer != null) clearTimeout(drainTimer);
    drainTimer = null;
    outbox.length = 0;
    reportedRuns.clear();
    sentThisSession = 0;
    stop = null;
  };
  return stop;
}
