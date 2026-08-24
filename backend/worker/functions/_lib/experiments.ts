/**
 * Package E2 — A/B experiment assignment, the shared half.
 *
 * Assignment is a pure function of (deviceId, experimentKey): FNV-1a over
 * "deviceId:key" → bucket 0-99 → walk the variants' cumulative percentages.
 * The client hook (src/features/experiments) implements the IDENTICAL
 * algorithm, which is the whole trick: the server can re-derive any device's
 * variant when aggregating metrics, so events need no experiment tagging and
 * the client sends nothing extra. Change one side and you break the join —
 * both sides carry tests pinned to the same fixtures.
 */

export interface ExperimentVariant {
  name: string;
  pct: number;
}

export interface ExperimentConfig {
  key: string;
  name?: string | null;
  variants: ExperimentVariant[];
  active: boolean;
}

/** FNV-1a 32-bit — tiny, uniform enough for 100 buckets. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function bucketOf(deviceId: string, key: string): number {
  return fnv1a(`${deviceId}:${key}`) % 100;
}

/** The device's variant, or null when the experiment is off / bucket falls
 *  outside the allocated traffic (variants may sum to < 100 — the remainder
 *  simply isn't in the experiment). */
export function assignVariant(deviceId: string, exp: ExperimentConfig): string | null {
  if (!exp.active || !deviceId || !exp.variants.length) return null;
  const b = bucketOf(deviceId, exp.key);
  let acc = 0;
  for (const v of exp.variants) {
    acc += Math.max(0, Math.floor(v.pct));
    if (b < acc) return v.name;
  }
  return null;
}

/** Parse + bound a variants payload from storage/admin input. */
export function sanitizeVariants(raw: unknown): ExperimentVariant[] {
  if (!Array.isArray(raw)) return [];
  const out: ExperimentVariant[] = [];
  let total = 0;
  for (const v of raw.slice(0, 6)) {
    const name = typeof (v as ExperimentVariant)?.name === 'string' ? (v as ExperimentVariant).name.trim().slice(0, 24) : '';
    const pct = Math.max(0, Math.min(100, Math.floor(Number((v as ExperimentVariant)?.pct) || 0)));
    if (!name || !pct) continue;
    if (total + pct > 100) break; // never over-allocate
    total += pct;
    out.push({ name, pct });
  }
  return out;
}
