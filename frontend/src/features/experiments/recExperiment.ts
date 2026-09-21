/**
 * 7.2.0 — recommendation experiments: assignment, the active variant map, and
 * exposure.
 *
 * ASSIGNMENT is the existing pure on-device hash (`pickVariant` in
 * ./useExperiment.ts, mirrored by the Worker's functions/_lib/experiments.ts):
 * FNV-1a over "installId:key" → bucket 0–99 → the experiment's cumulative
 * variant splits. Nothing is stored and no identifier is created: the install
 * id is the one usage telemetry already sends, and the variant names come from
 * the anonymous /api/experiments config. Until that config has loaded, or when
 * the experiment is absent, paused, or this device's bucket falls outside the
 * allocated traffic, the device is NOT in the experiment and reads 'control'.
 *
 * EXPOSURE is not assignment. A device is exposed to a recommendation
 * experiment only when a continuation that actually entered the queue went
 * through a decision point that reads the experiment. The decision point
 * calls `decideRecVariant(key)` while it plans — in EVERY arm, control
 * included, whenever the treatment would change (or, under control, would
 * have changed) that continuation; otherwise the arms cannot be compared. The
 * next continuation that is served claims the pending decisions
 * (`claimExposure(batch)`, called by the recommendation telemetry when the
 * player reports `served`), and only then does the experiment appear in that
 * continuation's `exp` map. A plan that was discarded before it was served
 * (the queue moved on) exposes nobody: its decisions expire.
 *
 * The owner's recommendation-tuning rollout (published weight overrides,
 * services/recommendation/weights.ts) is reported the same way under
 * `rec-config`: its variant name, or 'all' for a rollout to everyone. It
 * shapes every continuation planned while it is applied, so every served
 * continuation in that time carries it.
 *
 * Nothing here reaches the network except the config read, and nothing is
 * sent from here at all: the `exp` map rides the consent-gated
 * recommendation events (services/analytics/recTelemetry.ts).
 */
import { pickVariant } from './useExperiment';
import { installId } from '@/services/identity/installId';
import { isNativePlatform } from '@/services/native';
import { activeWeightOverride } from '@/services/recommendation/weights';

/** The next-song experiment slot. Create it in the owner console under exactly this key. */
export const EXP_REC_NEXT_SONGS = 'rec-next-songs';
/** The owner's recommendation-tuning rollout (weight overrides), when one is applied on this device. */
export const EXP_REC_CONFIG = 'rec-config';
/** Recommendation experiments this build can read. A key not listed here is never assigned, so never exposed. */
export const REC_EXPERIMENT_KEYS: readonly string[] = [EXP_REC_NEXT_SONGS];

interface Variant {
  name: string;
  pct: number;
}
export interface RecExperimentConfig {
  key: string;
  variants: Variant[];
}

const ENDPOINT = isNativePlatform() ? 'https://www.sirimillavinay.online/api/experiments' : '/api/experiments';
/** A decision the planner made for a continuation that was never served expires after this long. */
export const PENDING_DECISION_TTL_MS = 60_000;
/** Exposure maps kept per served continuation (for the outcome events of its songs). */
const EXPOSURE_MEMORY = 64;

/** key → variant, for experiments this device is IN (assignment, not exposure). */
let assigned = new Map<string, string>();
let loading: Promise<void> | null = null;
/** key → variant decided while planning, waiting for the continuation to be served. */
const pending = new Map<string, { variant: string; at: number }>();
/** batch → the experiments that affected that served continuation. */
const exposures = new Map<number, Record<string, string>>();
/** The exposure of the latest planned (non-reserve) continuation: a reserve top-up comes from that plan. */
let lastPlanExposure: Record<string, string> = {};

/** Variant names ride telemetry: the owner's own names (the Worker already bounds them to 24 characters), kept verbatim so they group server-side. */
const cleanName = (name: string): string => String(name).trim().slice(0, 24);

/** Apply a config (the /api/experiments payload's `experiments`). Exported for tests and for callers that already hold the config. */
export function setRecExperimentConfig(experiments: RecExperimentConfig[], deviceId: string = installId()): void {
  const next = new Map<string, string>();
  for (const exp of experiments) {
    if (!REC_EXPERIMENT_KEYS.includes(exp.key) || !Array.isArray(exp.variants)) continue;
    const variant = pickVariant(deviceId, exp.key, exp.variants);
    const name = variant ? cleanName(variant) : '';
    if (name) next.set(exp.key, name);
  }
  assigned = next;
}

/** Load the experiment config once per session. Failure leaves every device outside every experiment. */
export function loadRecExperiments(fetcher: typeof fetch = (...args) => fetch(...args)): Promise<void> {
  if (!loading) {
    loading = fetcher(ENDPOINT)
      .then((r) => (r.ok ? (r.json() as Promise<{ experiments?: RecExperimentConfig[] }>) : { experiments: [] }))
      .then((d) => setRecExperimentConfig(Array.isArray(d.experiments) ? d.experiments : []))
      .catch(() => undefined);
  }
  return loading;
}

/** This device's variant for `key` ('control' when not in the experiment). A pure read: it exposes nothing. */
export function recVariant(key: string): string {
  return assigned.get(key) ?? 'control';
}

/** The tuning rollout applied on this device right now, as an `exp` entry ({} on the default weights). */
function rolloutEntry(): Record<string, string> {
  const override = activeWeightOverride();
  if (!override) return {};
  return { [EXP_REC_CONFIG]: (override.variant && cleanName(override.variant)) || 'all' };
}

/** Every recommendation experiment this device is assigned to (key → variant), plus an applied tuning rollout. Assignment, not exposure. */
export function activeRecVariants(): Record<string, string> {
  return { ...Object.fromEntries(assigned), ...rolloutEntry() };
}

/**
 * The decision point. Returns this device's variant for `key` and, when the
 * device is in the experiment, records that the continuation being planned
 * now depends on it. Call it in every arm, at the point the variant would
 * change the plan. Outside the experiment it returns 'control' and records
 * nothing (that device is not part of the comparison).
 */
export function decideRecVariant(key: string, now: number = Date.now()): string {
  const variant = assigned.get(key);
  if (!variant) return 'control';
  pending.set(key, { variant, at: now });
  return variant;
}

/**
 * A continuation was served (it entered the queue): the decisions made while
 * planning it become its exposure, with the tuning rollout applied at that
 * moment. A reserve top-up comes from the latest plan, so it carries that
 * plan's exposure. Returns the continuation's `exp`.
 */
export function claimExposure(batch: number, opts: { reserve?: boolean; now?: number } = {}): Record<string, string> {
  const now = opts.now ?? Date.now();
  let exp: Record<string, string>;
  if (opts.reserve) {
    exp = { ...lastPlanExposure };
  } else {
    exp = rolloutEntry();
    for (const [key, d] of pending) if (now - d.at <= PENDING_DECISION_TTL_MS) exp[key] = d.variant;
    pending.clear();
    lastPlanExposure = exp;
  }
  exposures.set(batch, exp);
  while (exposures.size > EXPOSURE_MEMORY) exposures.delete(exposures.keys().next().value as number);
  return exp;
}

/** The exposure map of a served continuation ({} when none, or when it is no longer remembered). */
export function exposureOf(batch: number): Record<string, string> {
  return { ...(exposures.get(batch) ?? {}) };
}

/** Test hook. */
export function resetRecExperiments(): void {
  assigned = new Map();
  loading = null;
  pending.clear();
  exposures.clear();
  lastPlanExposure = {};
}
