import { Children, Fragment, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Song } from '@/types';
import { extractVibrantColor } from '@/utils/color';
import { cn } from '@/utils/cn';
import { IconButton } from './IconButton';
import { DotsIcon, PlayIcon } from './Icons';
import '@/styles/pages/library.css';

/**
 * VinaX 8 entity header — album, playlist, collection, liked songs, history…
 *
 * A wash of the artwork's own colour fades into the page behind a large
 * cover, a small type label, a display-size title and one meta line. The
 * action row underneath leads with the accent play button. Pages keep their
 * data, handlers and labels; this only arranges them.
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

export function EntityHeader({ kind, title, titleText, art, artUrl, tone, round, description, meta, children, actions, className }: EntityHeaderProps) {
  const sampled = useArtTone(tone ? undefined : artUrl);
  const hero = tone ?? sampled ?? 'var(--art)';
  const len = titleText?.length ?? 0;
  return (
    <section className={cn('vx-ehead', className)} style={{ '--hero': hero } as CSSProperties}>
      <div className="vx-ehead-wash" aria-hidden />
      <header className="vx-ehead-main">
        <div className={cn('vx-ehead-art', round && 'is-round')}>{art}</div>
        <div className="vx-ehead-body">
          <p className="vx-ehead-kind">{kind}</p>
          <h1 className={cn('vx-display vx-ehead-title', len > 40 ? 'is-xlong' : len > 22 && 'is-long')}>{title}</h1>
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

/** The 56px accent play button that leads every entity action row. */
export function PlayFab({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="vx-play-fab vx-ehead-fab" aria-label={label} title={label} onClick={onClick} disabled={disabled}>
      <PlayIcon />
    </button>
  );
}

/** A secondary action in the row (shuffle, share, download…): a 48px glyph button. */
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

/**
 * The row's ⋯ menu for the less frequent actions. Deliberately NOT labelled
 * "More options" — that name belongs to each song row's own menu.
 */
export function EntityMenu({ items, label = 'More actions' }: { items: (EntityMenuItem | null | false)[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const list = items.filter((x): x is EntityMenuItem => !!x);
  const trigger = () => wrap.current?.querySelector('button');

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
    <span ref={wrap} className="vx-emenu">
      <IconButton size="lg" label={label} onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls={open ? id : undefined} className="vx-ehead-icon">
        <DotsIcon className="w-6 h-6" />
      </IconButton>
      {open && (
        <div ref={menu} id={id} role="menu" aria-label={label} className="vx-emenu-panel" onKeyDown={move}>
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

/** Square glyph cover for lists without artwork of their own (liked songs, history…). */
export function GlyphCover({ icon, tone }: { icon: ReactNode; tone: 'liked' | 'later' | 'history' | 'downloads' }) {
  return <div className={cn('vx-glyph-cover', `is-${tone}`)} aria-hidden>{icon}</div>;
}
