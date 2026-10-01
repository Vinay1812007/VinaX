import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Song } from '@/types';
import { artSrcSet, bestImage, derivedVariants, FALLBACK_ART } from '@/utils/images';
import { cn } from '@/utils/cn';
import type { NativeName } from './scripts';
import '@/styles/pages/browse.css';

/**
 * 9.0 "Encore" — the browse tile family (styles/pages/browse.css).
 *
 *   BrowseTile   a category tile: title, one line, a visual in the corner.
 *                `shape="lane"` is the large one that fans real covers;
 *                `shape="mood"` is the compact one with a face.
 *   DestTile     a destination row: icon squircle and label.
 *
 * Tiles are links (`to`) or toggles (`onClick` + `pressed`). The tone
 * (`vx-tone-N`) only colours the corner glow and the icon squircle; copy is
 * always ink-100 on the charcoal surface, so every theme keeps its contrast.
 */

interface TileBase {
  title: string;
  meta?: string;
  /** A `vx-tone-N` class (see features/discover/tones.ts). */
  tone?: string;
  visual?: ReactNode;
  shape?: 'tile' | 'lane' | 'mood';
  className?: string;
  /** Accessible name, when the visible copy is not enough. */
  label?: string;
}
type LinkTile = TileBase & { to: string; onClick?: undefined; pressed?: undefined; busy?: undefined; disabled?: undefined };
type ButtonTile = TileBase & { to?: undefined; onClick: () => void; pressed?: boolean; busy?: boolean; disabled?: boolean };

export function BrowseTile(props: LinkTile | ButtonTile) {
  const { title, meta, tone, visual, shape = 'tile', className, label } = props;
  const cls = cn('bx-tile', shape !== 'tile' && `is-${shape}`, tone, className);
  const body = (
    <>
      <span className="bx-tile-text">
        <span className="bx-tile-title">{title}</span>
        {meta && <span className="bx-tile-meta">{meta}</span>}
      </span>
      {visual && (
        <span className="bx-tile-vis" aria-hidden>
          {visual}
        </span>
      )}
    </>
  );
  if (props.to !== undefined) {
    return (
      <Link to={props.to} className={cls} aria-label={label}>
        {body}
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={props.onClick}
      aria-pressed={props.pressed}
      aria-busy={props.busy || undefined}
      disabled={props.disabled}
      className={cls}
      aria-label={label}
    >
      {body}
    </button>
  );
}

/** One icon or character in a toned squircle. */
export function TileGlyph({ children, emoji, lang, ai }: { children: ReactNode; emoji?: boolean; lang?: string; ai?: boolean }) {
  return (
    <span className={cn('bx-glyph', emoji && 'is-emoji', ai && 'is-ai')} lang={lang}>
      {children}
    </span>
  );
}

/** Up to three short glyphs fanned like covers (scripts, mood faces). */
export function GlyphFan({ items, emoji }: { items: NativeName[] | string[]; emoji?: boolean }) {
  return (
    <span className={cn('bx-glyph-fan', emoji && 'is-emoji')}>
      {items.slice(0, 3).map((it) =>
        typeof it === 'string' ? (
          <span key={it}>{it}</span>
        ) : (
          <span key={it.text} lang={it.lang} dir={it.dir}>
            {it.text}
          </span>
        ),
      )}
    </span>
  );
}

/** Up to three real covers fanned in a lane's corner. Lazy, small, sized. */
export function CoverFan({ songs }: { songs: readonly Song[] }) {
  const picks = useMemo(() => {
    const seen = new Set<string>();
    const out: { id: string; src: string; srcSet?: string }[] = [];
    for (const s of songs) {
      if (out.length === 3) break;
      const dv = derivedVariants(s.images);
      const src = bestImage(dv, 150);
      if (src === FALLBACK_ART || seen.has(src)) continue;
      seen.add(src);
      out.push({ id: s.id, src, srcSet: artSrcSet(dv, 250) });
    }
    return out;
  }, [songs]);
  if (!picks.length) return null;
  return (
    <span className="bx-cover-fan">
      {picks.map((p) => (
        <img
          key={p.id}
          src={p.src}
          srcSet={p.srcSet}
          sizes="64px"
          alt=""
          width={64}
          height={64}
          loading="lazy"
          decoding="async"
          onError={(e) => {
            const t = e.currentTarget;
            t.srcset = '';
            t.src = FALLBACK_ART;
          }}
        />
      ))}
    </span>
  );
}

/** A destination row: a toned icon squircle, the name and one quiet line. */
export function DestTile({ to, title, meta, tone, icon, ai }: { to: string; title: string; meta?: string; tone?: string; icon: ReactNode; ai?: boolean }) {
  return (
    <Link to={to} className={cn('bx-dest', tone)}>
      <TileGlyph ai={ai}>{icon}</TileGlyph>
      <span className="bx-dest-text">
        <span className="bx-dest-title">{title}</span>
        {meta && <span className="bx-dest-meta">{meta}</span>}
      </span>
    </Link>
  );
}
