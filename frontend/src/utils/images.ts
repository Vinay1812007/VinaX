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

/**
 * The catalog only PUBLISHES 50/150/500 variants, but the artwork CDN also
 * serves 250x250 and 350x350 for the same asset (verified live 2026-08-17:
 * 200 image/jpeg at 15 KB / 26 KB vs 46 KB for the 500). Deriving those by
 * URL rewrite gives card tiles a sharp-on-retina middle ground — the 4.18.0
 * flat 150 cap read soft on 2x+ phones (owner report), while 500 was the
 * ~1 MB PSI finding. Only derives when a 500x500 URL exists to rewrite;
 * anything else passes through untouched.
 */
export function derivedVariants(images: ImageVariant[] | undefined): ImageVariant[] {
  const usable = usableVariants(images);
  const v500 = usable.find((v) => v.url.includes('500x500'));
  if (!v500) return usable;
  const have = new Set(usable.map((v) => qualityPx(v.quality)));
  return usable.concat(
    [250, 350]
      .filter((px) => !have.has(px))
      .map((px) => ({ quality: `${px}x${px}`, url: v500.url.replace(/500x500/g, `${px}x${px}`) })),
  );
}

/** srcset from the catalog's own size variants ("…50.jpg 50w, …150.jpg 150w, …500.jpg 500w").
 *
 *  `maxPx` caps which variants are offered (4.18.0, PSI "improve image
 *  delivery ~1 MB"): the catalog only publishes 50/150/500, so a ~150 px card
 *  tile on any 2x screen resolved to the 500×500 file — ~35 KB where ~6 KB
 *  serves the same cell. Card tiles cap at 150; hero/detail art passes no cap
 *  and keeps the full-quality 500. If the cap would remove every variant it
 *  is ignored (better a big image than none). */
export function artSrcSet(images: ImageVariant[] | undefined, maxPx?: number): string | undefined {
  const usable = usableVariants(images);
  if (usable.length === 0) return undefined;
  const all = usable
    .map((v) => ({ px: qualityPx(v.quality), url: v.url }))
    .filter((v) => v.px > 0)
    .sort((a, b) => a.px - b.px);
  const capped = maxPx ? all.filter((v) => v.px <= maxPx) : all;
  const parts = (capped.length ? capped : all).map((v) => `${v.url} ${v.px}w`);
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
