/**
 * 7.2.0 — does the owner's published weight override (`recConfig` in the
 * public client bundle, see backend _lib/clientConfig.ts) target THIS device?
 *
 *   { mode: 'all' }                                          → every device;
 *   { mode: 'experiment', experimentKey, variant, variants } → only devices whose
 *     variant of that A/B experiment is `variant`, decided by the same pure
 *     hash as useExperiment() over the split the Worker ships with the config.
 *
 * Anything else — a malformed config, a device outside the variant — means
 * "keep the defaults". Pure apart from reading the install id; nothing is
 * sent anywhere. syncRecConfig() in features/home/useAppConfig.ts loads this
 * module lazily, only once a config is published, and applies the decision
 * through weights.ts. (This module must not import weights.ts: sharing it
 * with a lazy chunk would split it out of the first-load player chunk.)
 */
import { installId } from '@/services/identity/installId';
import { pickVariant } from '@/features/experiments/useExperiment';

export type RecRolloutDecision =
  | { apply: true; version: number; variant: string | null; overrides: Record<string, unknown> }
  | { apply: false; reason: 'none' | 'malformed' | 'not-targeted' };

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

export function decideRecRollout(raw: unknown, deviceId: string = installId()): RecRolloutDecision {
  if (raw == null) return { apply: false, reason: 'none' };
  const cfg = obj(raw);
  const overrides = obj(cfg?.overrides);
  const rollout = obj(cfg?.rollout);
  const version = cfg?.version;
  if (!cfg || !overrides || !rollout || typeof version !== 'number' || !Number.isInteger(version) || version < 1) return { apply: false, reason: 'malformed' };
  if (rollout.mode === 'all') return { apply: true, version, variant: null, overrides };
  if (rollout.mode !== 'experiment') return { apply: false, reason: 'malformed' };
  const key = typeof rollout.experimentKey === 'string' ? rollout.experimentKey : '';
  const variant = typeof rollout.variant === 'string' ? rollout.variant : '';
  const split = Array.isArray(rollout.variants)
    ? rollout.variants.map(obj).filter((v): v is Record<string, unknown> => !!v && typeof v.name === 'string' && typeof v.pct === 'number').map((v) => ({ name: v.name as string, pct: v.pct as number }))
    : [];
  if (!key || !variant || !split.length) return { apply: false, reason: 'malformed' };
  return pickVariant(deviceId, key, split) === variant ? { apply: true, version, variant, overrides } : { apply: false, reason: 'not-targeted' };
}
