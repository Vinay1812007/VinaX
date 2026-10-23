/**
 * 13.9 — which renditions of a canvas clip exist, and which one to play.
 *
 * The CDN answers HEAD with CORS (`access-control-allow-origin: *`), so the
 * ladder above the catalogue's 540p is probed with cheap HEAD requests rather
 * than trusted. Probing is thrifty: heights ABOVE the named one are tried once
 * a day across all clips while none has ever existed, and per clip once one
 * has; the named height is taken as given, and the heights below it are taken
 * as given too (the CDN keeps a 360p beside every 540p we have seen) — a
 * missing one simply fails over to the next (useSongCanvas.markFailed).
 */
import { RENDITION_HEIGHTS, renditionHeight, renditionUrl } from '@/services/api/videos';

export interface Rendition {
  /** Pixel height; 0 when the URL names none (the badge then stays quiet). */
  height: number;
  url: string;
}

/** 'auto' picks for the screen; a number pins a height when the clip has it. */
export type QualityPreference = 'auto' | number;

const PREF_KEY = 'vinax.canvas.quality.v1';
const CEILING_KEY = 'vinax.canvas.ceiling.v1';
/** How often the ladder above the named height is re-probed while nothing up there exists. */
export const PROBE_EVERY_MS = 24 * 60 * 60_000;
const HEAD_TIMEOUT_MS = 4_000;

interface CeilingNote {
  /** The highest height ever confirmed above a clip's named one (0 = never). */
  height: number;
  /** When the ladder above was last probed. */
  at: number;
}

export function readPreference(storage: Pick<Storage, 'getItem'> | null = safeStorage()): QualityPreference {
  try {
    const raw = storage?.getItem(PREF_KEY);
    if (!raw || raw === 'auto') return 'auto';
    const n = Number(raw);
    return (RENDITION_HEIGHTS as readonly number[]).includes(n) ? n : 'auto';
  } catch {
    return 'auto';
  }
}

export function writePreference(p: QualityPreference, storage: Pick<Storage, 'setItem' | 'removeItem'> | null = safeStorage()): void {
  try {
    if (p === 'auto') storage?.removeItem(PREF_KEY);
    else storage?.setItem(PREF_KEY, String(p));
  } catch {
    /* per-device nicety only */
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function readCeiling(storage: Storage | null): CeilingNote {
  try {
    const raw = storage?.getItem(CEILING_KEY);
    const v = raw ? (JSON.parse(raw) as Partial<CeilingNote>) : null;
    return { height: Number(v?.height) || 0, at: Number(v?.at) || 0 };
  } catch {
    return { height: 0, at: 0 };
  }
}

function writeCeiling(storage: Storage | null, note: CeilingNote): void {
  try {
    storage?.setItem(CEILING_KEY, JSON.stringify(note));
  } catch {
    /* ignore */
  }
}

/**
 * Auto's target: the screen's longer side in device pixels (a 1080 × 2400
 * phone wants 2160p when it exists, a 1366 × 768 laptop 1080p), capped at 4K.
 */
export function autoTarget(view: { width: number; height: number; dpr: number } = viewport()): number {
  const px = Math.max(view.width, view.height) * Math.max(1, view.dpr || 1);
  return Math.min(2160, Math.max(360, Math.round(px)));
}

function viewport(): { width: number; height: number; dpr: number } {
  if (typeof window === 'undefined') return { width: 1080, height: 1920, dpr: 1 };
  return { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio || 1 };
}

/**
 * The rendition to play: the pinned height when the clip has it (else the
 * nearest below it, else the lowest above); on Auto the highest that does not
 * exceed the target (else the lowest). Heights that failed to play are skipped.
 */
export function pickRendition(list: readonly Rendition[], pref: QualityPreference, target: number, failed: ReadonlySet<number> = new Set()): Rendition | null {
  const ok = list.filter((r) => !failed.has(r.height)).sort((a, b) => b.height - a.height);
  if (!ok.length) return null;
  if (pref !== 'auto') {
    return ok.find((r) => r.height === pref) ?? ok.find((r) => r.height < pref) ?? ok[ok.length - 1];
  }
  return ok.find((r) => r.height <= target) ?? ok[ok.length - 1];
}

async function exists(url: string, fetchImpl: typeof fetch): Promise<boolean> {
  const controller = typeof AbortController === 'undefined' ? null : new AbortController();
  const timer = controller ? setTimeout(() => controller.abort(), HEAD_TIMEOUT_MS) : null;
  try {
    const res = await fetchImpl(url, { method: 'HEAD', mode: 'cors', cache: 'force-cache', signal: controller?.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const memo = new Map<string, Promise<Rendition[]>>();

/** Tests only. */
export function resetRenditionMemo(): void {
  memo.clear();
}

/**
 * Every rendition this clip can be played at, highest first. The named one
 * is always present; heights below it are listed without a probe; heights
 * above are probed by the policy in the file comment.
 */
export function availableRenditions(
  previewUrl: string,
  opts: { fetchImpl?: typeof fetch; now?: number; storage?: Storage | null } = {},
): Promise<Rendition[]> {
  const hit = memo.get(previewUrl);
  if (hit) return hit;
  const run = (async (): Promise<Rendition[]> => {
    const base = renditionHeight(previewUrl);
    if (base == null) return [{ height: 0, url: previewUrl }];
    const storage = opts.storage === undefined ? safeStorage() : opts.storage;
    const now = opts.now ?? Date.now();
    const fetchImpl = opts.fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
    const above = RENDITION_HEIGHTS.filter((h) => h > base);
    const below = RENDITION_HEIGHTS.filter((h) => h < base);
    const list: Rendition[] = [];
    const note = readCeiling(storage);
    const probe = !!fetchImpl && above.length > 0 && (note.height > base || now - note.at >= PROBE_EVERY_MS);
    if (probe && fetchImpl) {
      const found = await Promise.all(
        above.map(async (h) => {
          const url = renditionUrl(previewUrl, h);
          return url && (await exists(url, fetchImpl)) ? { height: h, url } : null;
        }),
      );
      for (const r of found) if (r) list.push(r);
      const best = list.reduce((m, r) => Math.max(m, r.height), 0);
      writeCeiling(storage, { height: Math.max(best, note.height), at: now });
    }
    list.push({ height: base, url: previewUrl });
    for (const h of below) {
      const url = renditionUrl(previewUrl, h);
      if (url) list.push({ height: h, url });
    }
    return list.sort((a, b) => b.height - a.height);
  })();
  memo.set(previewUrl, run);
  return run;
}
