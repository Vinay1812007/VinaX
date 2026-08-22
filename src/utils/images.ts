import type { ImageVariant } from '@/types';

/** Original inline placeholder artwork — no third-party assets. */
export const FALLBACK_ART =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" fill="#10131f"/><path d="M16 80 Q32 56 48 80 T80 80 T112 80" fill="none" stroke="#a3e635" stroke-width="7" stroke-linecap="round"/><path d="M16 96 Q32 78 48 96 T80 96 T112 96" fill="none" stroke="#a78bfa" stroke-width="5" stroke-linecap="round" opacity="0.8"/></svg>`,
  );

function qualityPx(q: unknown): number {
  const m = typeof q === 'string' ? q.match(/(\d+)x(\d+)/) : null;
  return m ? Number(m[1]) : 0;
}

/** Entries can come from persisted/untrusted data — only keep usable ones. */
function usableVariants(images: ImageVariant[] | undefined): ImageVariant[] {
  if (!Array.isArray(images)) return [];
  return images.filter(
    (v): v is ImageVariant => !!v && typeof v === 'object' && typeof v.url === 'string' && v.url.length > 0,
  );
}

/** srcset from the catalog's own size variants ("…50.jpg 50w, …150.jpg 150w, …500.jpg 500w"). */
export function artSrcSet(images: ImageVariant[] | undefined): string | undefined {
  const usable = usableVariants(images);
  if (usable.length === 0) return undefined;
  const parts = usable
    .map((v) => ({ px: qualityPx(v.quality), url: v.url }))
    .filter((v) => v.px > 0)
    .sort((a, b) => a.px - b.px)
    .map((v) => `${v.url} ${v.px}w`);
  const unique = [...new Set(parts)];
  return unique.length > 1 ? unique.join(', ') : undefined;
}

/** Pick the smallest image that is at least `min` px, else the largest.
 *  Defensive against non-array/malformed input (corrupt persisted state):
 *  anything unusable falls back to the inline placeholder (DQA-04). */
export function bestImage(images: ImageVariant[] | undefined, min = 300): string {
  const usable = usableVariants(images);
  if (usable.length === 0) return FALLBACK_ART;
  const sorted = [...usable].sort((a, b) => qualityPx(a.quality) - qualityPx(b.quality));
  const fit = sorted.find((v) => qualityPx(v.quality) >= min);
  return (fit ?? sorted[sorted.length - 1]).url || FALLBACK_ART;
}
