/**
 * 1.11 — the four sound-quality levels, shared by streaming, downloads and the
 * player's quick Quality menu.
 *
 * The stored ids predate the four labels: 'low' / 'medium' / 'high' were the
 * 96 / 160 / 320 kbps levels, and they still are, so a saved choice (and a
 * choice synced from a device on an older app) keeps the exact bitrate it
 * had. Only the names changed, and 'saver' (48 kbps) joined below them:
 *
 *   saver  → Low        48 kbps
 *   low    → Medium     96 kbps
 *   medium → High      160 kbps
 *   high   → Very high 320 kbps (the best the catalogue has)
 */
export type AudioQualityPref = 'saver' | 'low' | 'medium' | 'high';


// A literal list (not mapped from QUALITY_LEVELS) so the settings store, in the app shell, doesn't pull in the labels.
export const QUALITY_IDS: readonly AudioQualityPref[] = ['saver', 'low', 'medium', 'high'];


/** Parse the bitrate (kbps) out of a quality label like "320kbps", "320" or "320 kbps". */
export function bitrateOf(quality: string | undefined): number {
  const m = String(quality ?? '').match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

/**
 * Order variants for a level: "Very high" puts the highest bitrate first; the
 * others take the variant nearest their target, then the next nearest (a
 * higher one wins a tie), so a missing file still falls back to something.
 */
export function orderByQuality<T extends { quality: string }>(variants: readonly T[], pref: AudioQualityPref): T[] {
  // A plain map, not QUALITY_LEVELS: the engine (app shell) imports this, and the labels stay out of the first load.
  const target = { saver: 48, low: 96, medium: 160, high: Infinity }[pref] ?? Infinity;
  return [...variants].sort((a, b) => {
    const ba = bitrateOf(a.quality);
    const bb = bitrateOf(b.quality);
    if (target === Infinity) return bb - ba;
    return Math.abs(ba - target) - Math.abs(bb - target) || bb - ba;
  });
}
