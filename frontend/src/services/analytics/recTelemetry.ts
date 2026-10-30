import { isCompletion, isEarlyLeave, onPlaybackEvent, playThreshold, type PlaybackEndReason, type PlaybackEvent } from '@/services/playback/session';
import { useLibraryStore } from '@/store/libraryStore';
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
 *   rec_served   once per automatic continuation, as it is queued.
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
 * `latencyMs` is the queue-ready latency — from the plan call to a queueable
 * order. `exp` is the continuation's exposure map
 * (features/experiments/recExperiment.ts), including an applied owner
 * tuning rollout under `rec-config`.
 *
 * Volume. A token bucket (REC_BUCKET events, one more every REC_REFILL_MS)
 * feeds a small outbox; beyond REC_OUTBOX_CAP waiting events, or
 * REC_SESSION_CAP events in one session, new events are dropped. A long
 * session, or a burst of skips, cannot flood the endpoint.
 */
export type RecPicker = 'local' | 'reserve';
export type RecFallback = null | 'deadline' | 'error';
export type RecOutcome = 'complete' | 'skip' | 'early_skip' | 'partial';

export const REC_BUCKET = 12;
export const REC_REFILL_MS = 5_000;
export const REC_OUTBOX_CAP = 40;
export const REC_SESSION_CAP = 400;

const FALLBACKS = new Set(['deadline', 'error']);
const fallbackOf = (f: string | null | undefined): RecFallback => (f == null ? null : FALLBACKS.has(f) ? (f as RecFallback) : 'error');
const pickerOf = (p: string): RecPicker => (p === 'reserve' ? p : 'local');
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
type Ended = Extract<PlaybackEvent, { kind: 'end' }>;

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

function onServed(e: Served): void {
  // A listener who opted in mid-session: read the experiment config now (once).
  void loadRecExperiments();
  const exp = claimExposure(e.batch, { reserve: e.picker === 'reserve' });
  enqueue('rec_served', {
    alg: e.alg,
    picker: pickerOf(e.picker),
    fallback: fallbackOf(e.fallback),
    latencyMs: whole(e.latencyMs),
    n: whole(e.n),
    discovery: whole(e.discovery),
    languageViolations: whole(e.languageViolations),
    distinctArtists: whole(e.distinctArtists),
    relaxed: e.relaxed.slice(0, 4).map((r) => String(r).slice(0, 24)),
    exp,
  });
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
    else if (e.kind === 'end') onEnded(e);
  });
  stop = () => {
    unsubscribe();
    if (drainTimer != null) clearTimeout(drainTimer);
    drainTimer = null;
    outbox.length = 0;
    reportedRuns.clear();
    sentThisSession = 0;
    stop = null;
  };
  return stop;
}
