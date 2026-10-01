import { Children, Fragment, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Song } from '@/types';
import { extractVibrantColor } from '@/utils/color';
import { cn } from '@/utils/cn';
import { IconButton } from './IconButton';
import { DotsIcon, PlayIcon } from './Icons';
import '@/styles/pages/library.css';

/**
 * VinaX 9 "Encore" entity header — album, playlist, artist, song, collection,
 * liked songs, history, downloads, mixes.
 *
 * The artwork leads: a squircle cover (a circle for people) over a wash of
 * the artwork's own colour that fades into the workspace. Copy follows — a
 * small type label, a display-size title that steps down for long names, an
 * optional description and one meta line. The action row underneath has one
 * obvious play action (the Iris squircle), then quiet round actions and the
 * ⋯ menu. Pages keep their data, handlers and labels; this only arranges them.
 */

/** "R G B" of the artwork's most vibrant tone, or null while unknown / unreadable. */
export function useArtTone(url: string | undefined): string | null {
  const [tone, setTone] = useState<{ url: string; rgb: string | null } | null>(null);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    void extractVibrantColor(url).then((rgb) => alive && setTone({ url, rgb }));
    return () => {
      alive = false;
    };
  }, [url]);
  return tone && tone.url === url ? tone.rgb : null;
}

/** Total running time for a meta line: "48 min", "1 hr 12 min". Empty when unknown. */
export function totalDuration(songs: readonly Pick<Song, 'duration'>[]): string {
  const secs = songs.reduce((sum, s) => sum + (s.duration || 0), 0);
  if (secs <= 0) return '';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${Math.max(1, mins)} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

/** "12 songs" / "1 song". */
export const songsLabel = (n: number): string => `${n} song${n === 1 ? '' : 's'}`;

interface EntityHeaderProps {
  /** Small type label above the title: "Album", "Playlist", "Artist". */
  kind: string;
  title: ReactNode;
  /** Plain-text title — long ones step the display size down. */
  titleText?: string;
  /** The cover (img, collage, glyph tile). Sized by the header. */
  art: ReactNode;
  /** Artwork URL to sample the header colour from. */
  artUrl?: string;
  /** Explicit header colour as an "R G B" triplet or `var(--token)`; wins over artUrl. */
  tone?: string;
  /** A person: the cover is a circle instead of a squircle. */
  round?: boolean;
  description?: ReactNode;
  /** The meta line — pass <EntityMeta items={…} />. */
  meta?: ReactNode;
  /** Extra body content under the meta line (inline edit form, tag chips). */
  children?: ReactNode;
  /** The action row — lead with <PlayFab />. */
  actions?: ReactNode;
  className?: string;
}

/** Title length (in UTF-16 units, close enough for a size step) → size class. */
function titleSize(text: string | undefined): string | undefined {
  const len = text?.length ?? 0;
  if (len > 44) return 'is-xlong';
  if (len > 22) return 'is-long';
  return undefined;
}

export function EntityHeader({ kind, title, titleText, art, artUrl, tone, round, description, meta, children, actions, className }: EntityHeaderProps) {
  const sampled = useArtTone(tone ? undefined : artUrl);
  const hero = tone ?? sampled ?? 'var(--art)';
  return (
    <section className={cn('vx-ehead', round && 'is-person', className)} style={{ '--hero': hero } as CSSProperties}>
      <div className="vx-ehead-wash" aria-hidden />
      <header className="vx-ehead-main">
        <div className={cn('vx-ehead-art', round && 'is-round')}>{art}</div>
        <div className="vx-ehead-body">
          <p className="vx-ehead-kind">{kind}</p>
          <h1 className={cn('vx-display vx-ehead-title', titleSize(titleText))}>{title}</h1>
          {description && <p className="vx-ehead-desc">{description}</p>}
          {meta}
          {children}
        </div>
      </header>
      {actions && <div className="vx-ehead-actions">{actions}</div>}
    </section>
  );
}

/** One meta line: the first item reads stronger, the rest are joined by a middle dot. */
export function EntityMeta({ items }: { items: ReactNode[] }) {
  const shown = Children.toArray(items.filter((x) => x !== null && x !== undefined && x !== false && x !== ''));
  if (!shown.length) return null;
  return (
    <p className="vx-ehead-meta">
      {shown.map((item, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="vx-ehead-dot" aria-hidden> · </span>}
          <span className={i === 0 ? 'is-lead' : undefined}>{item}</span>
        </Fragment>
      ))}
    </p>
  );
}

/**
 * The Iris squircle that leads every entity action row. `lg` (64px, 56px on
 * phones) is the entity-page size; `md` (56px) suits smaller result headers.
 */
export function PlayFab({ label, onClick, disabled, size = 'md' }: { label: string; onClick: () => void; disabled?: boolean; size?: 'md' | 'lg' }) {
  return (
    <button type="button" className={cn('vx-play-fab vx-ehead-fab', size === 'lg' && 'is-lg')} aria-label={label} title={label} onClick={onClick} disabled={disabled}>
      <PlayIcon />
    </button>
  );
}

/** A secondary action in the row (shuffle, share, download…): a quiet 48px round button. */
export function EntityAction({ label, onClick, children, active, disabled, 'aria-pressed': pressed }: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  active?: boolean;
  disabled?: boolean;
  'aria-pressed'?: boolean;
}) {
  return (
    <IconButton size="lg" label={label} onClick={onClick} active={active} disabled={disabled} aria-pressed={pressed} className="vx-ehead-icon">
      {children}
    </IconButton>
  );
}

export interface EntityMenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/** Room the player deck / tab bar takes at the bottom of the viewport. */
const BOTTOM_CHROME = 160;

/**
 * The ⋯ menu for the less frequent actions. Deliberately NOT labelled
 * "More options" — that name belongs to each song row's own menu.
 *
 * `size="md"` gives the 40px trigger used inside list rows; `align="end"`
 * anchors the panel to the trigger's right edge (rows, cards). The panel
 * opens upward when there is no room below it above the player.
 */
export function EntityMenu({
  items,
  label = 'More actions',
  size = 'lg',
  align = 'start',
  className,
}: {
  items: (EntityMenuItem | null | false)[];
  label?: string;
  size?: 'md' | 'lg';
  align?: 'start' | 'end';
  /** Extra classes for the trigger button. */
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const list = items.filter((x): x is EntityMenuItem => !!x);
  const trigger = () => wrap.current?.querySelector('button');

  // Measure before paint, so the panel never flashes on the wrong side.
  useLayoutEffect(() => {
    if (!open || !wrap.current) return;
    const rect = wrap.current.getBoundingClientRect();
    const need = list.length * 44 + 24;
    const below = window.innerHeight - rect.bottom - BOTTOM_CHROME;
    setUp(below < need && rect.top > need + 64);
  }, [open, list.length]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      wrap.current?.querySelector('button')?.focus({ preventScroll: true });
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!list.length) return null;
  const move = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const els = [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
    if (!els.length) return;
    const at = els.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? els.length - 1 : (at + (e.key === 'ArrowDown' ? 1 : -1) + els.length) % els.length;
    els[next].focus();
  };
  return (
    <span ref={wrap} className={cn('vx-emenu', open && 'is-open')}>
      <IconButton
        size={size}
        label={label}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        className={className ?? 'vx-ehead-icon'}
      >
        <DotsIcon className={size === 'lg' ? 'w-6 h-6' : 'w-5 h-5'} />
      </IconButton>
      {open && (
        <div
          ref={menu}
          id={id}
          role="menu"
          aria-label={label}
          className={cn('vx-emenu-panel', align === 'end' && 'is-end', up && 'is-up')}
          onKeyDown={move}
        >
          {list.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              className={cn('vx-emenu-item', item.danger && 'is-danger')}
              onClick={() => {
                setOpen(false);
                trigger()?.focus({ preventScroll: true });
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

export type GlyphTone = 'liked' | 'later' | 'history' | 'downloads' | 'smart';

/** Square glyph cover for lists without artwork of their own (liked songs, history…). */
export function GlyphCover({ icon, tone }: { icon: ReactNode; tone: GlyphTone }) {
  return <div className={cn('vx-glyph-cover', `is-${tone}`)} aria-hidden>{icon}</div>;
}
