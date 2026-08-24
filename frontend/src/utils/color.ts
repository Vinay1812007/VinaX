/**
 * Artwork color extraction for dynamic theming — one pixel loader, two
 * rankings: a darkened average (mini-player backgrounds) and a vibrancy-
 * weighted accent (the global living color, --art).
 * CORS-dependent: unreadable canvases quietly resolve to null.
 */

const MAX_CACHE = 80;

function lruSet<K, V>(map: Map<K, V>, key: K, value: V) {
  if (map.has(key)) map.delete(key); // re-insert at end
  map.set(key, value);
  if (map.size > MAX_CACHE) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
}

function loadPixels(url: string, size: number): Promise<Uint8ClampedArray | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onerror = () => resolve(null);
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, size, size);
        resolve(ctx.getImageData(0, 0, size, size).data);
      } catch {
        resolve(null);
      }
    };
    img.src = url;
  });
}

const avgCache = new Map<string, string | null>();

/** Darkened average color as a CSS `rgb(...)` string (player backgrounds). */
export function extractAverageColor(url: string): Promise<string | null> {
  if (avgCache.has(url)) return Promise.resolve(avgCache.get(url) ?? null);
  return loadPixels(url, 16).then((d) => {
    let out: string | null = null;
    if (d) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) {
        r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
      }
      // Darken toward the ink palette so overlaid text stays readable.
      out = `rgb(${Math.round((r / n) * 0.45)}, ${Math.round((g / n) * 0.45)}, ${Math.round((b / n) * 0.45)})`;
    }
    lruSet(avgCache, url, out);
    return out;
  });
}

/** Feed the living accent: sets/clears the global --art custom property. */
export function applyArtColor(rgbTriplet: string | null): void {
  const el = document.documentElement;
  if (rgbTriplet) el.style.setProperty('--art', rgbTriplet);
  else el.style.removeProperty('--art');
}

const vibrantCache = new Map<string, string | null>();

/**
 * Vibrancy-weighted color as an "R G B" triplet for rgb(var(--art) / a).
 * Saturated mid-luma pixels dominate; the result is lifted to a UI-safe
 * brightness.
 */
export function extractVibrantColor(url: string): Promise<string | null> {
  if (vibrantCache.has(url)) return Promise.resolve(vibrantCache.get(url) ?? null);
  return loadPixels(url, 24).then((d) => {
    let out: string | null = null;
    if (d) {
      let r = 0, g = 0, b = 0, w = 0;
      for (let i = 0; i < d.length; i += 4) {
        const pr = d[i], pg = d[i + 1], pb = d[i + 2];
        const sat = Math.max(pr, pg, pb) - Math.min(pr, pg, pb);
        const luma = 0.2126 * pr + 0.7152 * pg + 0.0722 * pb;
        const wt = sat * (luma > 40 && luma < 215 ? 1 : 0.15);
        r += pr * wt; g += pg * wt; b += pb * wt; w += wt;
      }
      if (w >= 1) {
        r /= w; g /= w; b /= w;
        const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        if (luma < 92) {
          const k = 92 / Math.max(luma, 1);
          r = Math.min(255, r * k); g = Math.min(255, g * k); b = Math.min(255, b * k);
        }
        out = `${Math.round(r)} ${Math.round(g)} ${Math.round(b)}`;
      }
    }
    lruSet(vibrantCache, url, out);
    return out;
  });
}
