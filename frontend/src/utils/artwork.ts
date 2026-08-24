/**
 * Converts artwork URLs to base64 data URIs for the native media notification.
 * The plugin's native HttpURLConnection artwork fetch is flaky on some
 * devices/networks — but the WebView already loads these images fine, so we
 * decode them here and hand native a data URI (its base64 path is reliable).
 * CORS-tainted images return null and the caller falls back gracefully.
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

const cache = new Map<string, string | null>();

export function artworkDataUrl(url: string, size = 256): Promise<string | null> {
  if (cache.has(url)) return Promise.resolve(cache.get(url) ?? null);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('no ctx');
        ctx.drawImage(img, 0, 0, size, size);
        const data = canvas.toDataURL('image/jpeg', 0.82);
        lruSet(cache, url, data);
        resolve(data);
      } catch {
        lruSet(cache, url, null);
        resolve(null);
      }
    };
    img.onerror = () => {
      lruSet(cache, url, null);
      resolve(null);
    };
    img.src = url;
  });
}
