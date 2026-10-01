import { useMemo, type ReactNode } from 'react';
import type { Song } from '@/types';
import { artSrcSet, bestImage, derivedVariants, FALLBACK_ART } from '@/utils/images';
import { NATIVE_NAMES } from './scripts';
import '@/styles/pages/browse.css';

/**
 * Covers for the hub headers (language, mood and chart pages), which have
 * no artwork of their own: a 2 × 2 mosaic of the first four covers on the
 * list once it has loaded, or a toned squircle with the language's script
 * (or an icon) until then. The tone comes from a `vx-tone-N` ancestor.
 */
export function HubCover({ songs, language, icon }: { songs?: readonly Song[]; language?: string; icon?: ReactNode }) {
  const tiles = useMemo(() => {
    const seen = new Set<string>();
    const out: { id: string; src: string; srcSet?: string }[] = [];
    for (const s of songs ?? []) {
      if (out.length === 4) break;
      const dv = derivedVariants(s.images);
      const src = bestImage(dv, 150);
      if (src === FALLBACK_ART || seen.has(src)) continue;
      seen.add(src);
      out.push({ id: s.id, src, srcSet: artSrcSet(dv, 250) });
    }
    return out;
  }, [songs]);

  if (tiles.length === 4) {
    return (
      <div className="bx-mosaic" aria-hidden>
        {tiles.map((t) => (
          <img key={t.id} src={t.src} srcSet={t.srcSet} sizes="(min-width: 768px) 116px, 80px" alt="" width={116} height={116} decoding="async" />
        ))}
      </div>
    );
  }
  const native = language ? NATIVE_NAMES[language] : undefined;
  return (
    <div className="bx-cover-script" aria-hidden>
      {native ? (
        <span lang={native.lang} dir={native.dir}>
          {native.text}
        </span>
      ) : (
        icon
      )}
    </div>
  );
}
