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

/** 1.12 — streaming may also follow the connection ('auto'); downloads always name a level. */
export type StreamQualityPref = AudioQualityPref | 'auto';


// A literal list (not mapped from QUALITY_LEVELS) so the settings store, in the app shell, doesn't pull in the labels.
export const QUALITY_IDS: readonly AudioQualityPref[] = ['saver', 'low', 'medium', 'high'];
export const STREAM_QUALITY_IDS: readonly StreamQualityPref[] = ['auto', ...QUALITY_IDS];

/** What the browser says about the connection (the Network Information API, where it exists). */
export interface NetworkFacts {
  saveData?: boolean;
  /** 'slow-2g' | '2g' | '3g' | '4g' */
  effectiveType?: string;
  /** 'wifi' | 'ethernet' | 'cellular' | 'bluetooth' | 'none' | 'other' | 'unknown' */
  type?: string;
}

export function networkFacts(): NetworkFacts {
  const nav = typeof navigator === 'undefined' ? null : (navigator as Navigator & { connection?: NetworkFacts; mozConnection?: NetworkFacts; webkitConnection?: NetworkFacts });
  const c = nav?.connection ?? nav?.mozConnection ?? nav?.webkitConnection;
  return c ? { saveData: c.saveData, effectiveType: c.effectiveType, type: c.type } : {};
}

/**
 * The level Auto picks for a connection: Wi-Fi or a wire → Very high; 4G →
 * High; 3G → Medium; 2G or the browser's data saver → Low. A browser that
 * says nothing (Safari, Firefox) gets High: good sound, not the heaviest file.
 */
export function autoQuality(net: NetworkFacts = networkFacts()): AudioQualityPref {
  if (net.saveData) return 'saver';
  const t = String(net.effectiveType ?? '');
  if (t === 'slow-2g' || t === '2g') return 'saver';
  if (t === '3g') return 'low';
  if (net.type === 'wifi' || net.type === 'ethernet') return 'high';
  return 'medium';
}

/** The level to stream at right now, for a stored choice. */
export const resolveStreamQuality = (pref: StreamQualityPref): AudioQualityPref => (pref === 'auto' ? autoQuality() : pref);


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
