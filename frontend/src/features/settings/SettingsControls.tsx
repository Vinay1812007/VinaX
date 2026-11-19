import { createContext, useContext, useId, useLayoutEffect, useRef, useState, type ComponentType, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { useT } from '@/i18n';
import { Link } from 'react-router-dom';
import { cn } from '@/utils/cn';
import { CheckIcon, ChevronRightIcon } from '@/components/Icons';

/**
 * 9.0 "Encore" — the Settings building blocks. Presentational only: every
 * control takes its value and its setter from the page, which reads and
 * writes the stores exactly as before.
 *
 * Search (v5.19.0): a query filters every row by its label, note and
 * keywords (case-insensitive, every word must match); a group or section
 * with no row left collapses; the first matching word is highlighted.
 * Rows that pass the query render `data-settings-row`, which is what the
 * sections, the match count and the e2e specs look for.
 */

export const SettingsSearchCtx = createContext('');

/**
 * Basic or All. Basic shows the everyday sections only; All shows every
 * section. A search always looks through everything.
 */
export type SettingsView = 'basic' | 'all';
export const SettingsViewCtx = createContext<SettingsView>('all');
/** The sections Basic keeps. */
export const BASIC_SECTIONS: ReadonlySet<string> = new Set(['profile', 'appearance', 'playback', 'notifications', 'your-data', 'help']);

const VIEW_KEY = 'vinax.settings.view.v1';
/** The remembered view; All when none was chosen or storage is unavailable. */
export function loadSettingsView(): SettingsView {
  try {
    return window.localStorage.getItem(VIEW_KEY) === 'basic' ? 'basic' : 'all';
  } catch {
    return 'all';
  }
}
export function saveSettingsView(v: SettingsView): void {
  try {
    window.localStorage.setItem(VIEW_KEY, v);
  } catch {
    /* private mode: the choice lasts until the page closes */
  }
}

/** True when a section shows under this view and query. */
export function sectionVisible(id: string, view: SettingsView, q: string): boolean {
  return view === 'all' || !!q || BASIC_SECTIONS.has(id);
}
/** The id of the row's note, so the control inside can point at it. */
const RowNoteCtx = createContext<string | undefined>(undefined);

export function matchesQuery(q: string, ...texts: Array<string | undefined>): boolean {
  if (!q) return true;
  const hay = texts.filter(Boolean).join(' ').toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

function Highlight({ text, q }: { text: string; q: string }) {
  const w = q.trim().split(/\s+/).filter(Boolean)[0];
  if (!w) return <>{text}</>;
  const i = text.toLowerCase().indexOf(w.toLowerCase());
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="vx-set-mark">{text.slice(i, i + w.length)}</mark>
      {text.slice(i + w.length)}
    </>
  );
}

/* ------------------------------------------------------------------ rows */

/**
 * One settings row: label and a one-line note on the left, the control on
 * the right. `stack` — for wide controls (segmented choices, sliders,
 * swatches): on phones the control drops below the label at full width.
 */
export function Row({ label, note, keywords, children, stack }: { label: string; note?: string; keywords?: string; children: ReactNode; stack?: boolean }) {
  const q = useContext(SettingsSearchCtx);
  const noteId = useId();
  const t = useT();
  // The label shows in the app language; search finds it in English or translated.
  const shown = t(label);
  if (!matchesQuery(q, shown === label ? label : `${label} ${shown}`, note, keywords)) return null;
  return (
    <div data-settings-row className={cn('vx-set-row', stack && 'is-stack')}>
      <div className="vx-set-text">
        <p className="vx-set-label"><Highlight text={shown} q={q} /></p>
        {note && <p id={noteId} className="vx-set-hint"><Highlight text={note} q={q} /></p>}
      </div>
      <div className="vx-set-control">
        <RowNoteCtx.Provider value={note ? noteId : undefined}>{children}</RowNoteCtx.Provider>
      </div>
    </div>
  );
}

/**
 * A full-width settings block: like `Row`, but the control sits under the
 * label instead of beside it. Takes part in Settings search like every row.
 */
export function Block({ label, note, keywords, action, children }: { label: string; note?: string; keywords?: string; action?: ReactNode; children: ReactNode }) {
  const q = useContext(SettingsSearchCtx);
  if (!matchesQuery(q, label, note, keywords)) return null;
  return (
    <div data-settings-row className="vx-set-row is-block">
      <div className="vx-set-block-head">
        <div className="vx-set-text">
          <p className="vx-set-label"><Highlight text={label} q={q} /></p>
          {note && <p className="vx-set-hint"><Highlight text={note} q={q} /></p>}
        </div>
        {action}
      </div>
      <div className="vx-set-block-body">{children}</div>
    </div>
  );
}

/** A row that goes somewhere: the whole row is the link (or button), with a chevron. */
export function LinkRow({ to, onClick, label, note, keywords, value }: { to?: string; onClick?: () => void; label: string; note?: string; keywords?: string; value?: string }) {
  const q = useContext(SettingsSearchCtx);
  if (!matchesQuery(q, label, note, keywords)) return null;
  const inner = (
    <>
      <span className="vx-set-text">
        <span className="vx-set-label"><Highlight text={label} q={q} /></span>
        {note && <span className="vx-set-hint"><Highlight text={note} q={q} /></span>}
      </span>
      <span className="vx-set-control">
        {value && <span className="vx-set-value">{value}</span>}
        <ChevronRightIcon className="vx-set-chev" />
      </span>
    </>
  );
  return to ? (
    <Link data-settings-row to={to} className="vx-set-row is-link">{inner}</Link>
  ) : (
    <button data-settings-row type="button" onClick={onClick} className="vx-set-row is-link">{inner}</button>
  );
}

/* -------------------------------------------------------------- controls */

/** A switch: Iris track when on, a knob that slides; 44px to hit (`.vx-tap`). */
export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  const noteId = useContext(RowNoteCtx);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      aria-describedby={noteId}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className="vx-tap vx-set-switch"
    >
      <span />
    </button>
  );
}

/**
 * Arrow keys, Home and End move the choice inside a radio group, and only
 * the chosen option sits in the Tab order (the WAI-ARIA radio pattern).
 */
function useRovingChoice<T>(values: T[], value: T, onChange: (v: T) => void) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const at = values.indexOf(value);
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number): void => {
    const last = values.length - 1;
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i === last ? 0 : i + 1)
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (i === 0 ? last : i - 1)
          : e.key === 'Home' ? 0
            : e.key === 'End' ? last
              : -1;
    if (next < 0) return;
    e.preventDefault();
    onChange(values[next]);
    refs.current[next]?.focus();
  };
  return {
    ref: (i: number) => (el: HTMLButtonElement | null) => {
      refs.current[i] = el;
    },
    tabIndex: (i: number) => (i === (at < 0 ? 0 : at) ? 0 : -1),
    onKeyDown,
  };
}

/**
 * A small set of mutually exclusive choices as one segmented radio group.
 * The chosen option sits on a solid accent thumb that slides to the new
 * choice (measured from the buttons, re-measured when they resize); until it
 * is measured, the chosen button paints its own background instead.
 *
 * `cols`: on a phone, lay the choices out in rows of this many instead of one
 * squeezed line (the six app languages do not fit one line at 360 px). The
 * thumb follows the chosen button down a row too.
 */
export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
  cols,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string; title?: string }>;
  onChange: (v: T) => void;
  cols?: number;
}) {
  const roving = useRovingChoice(options.map((o) => o.value), value, onChange);
  const group = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const at = options.findIndex((o) => o.value === value);
  useLayoutEffect(() => {
    const el = group.current;
    if (!el) return;
    const measure = (): void => {
      const btn = at < 0 ? null : el.querySelectorAll<HTMLButtonElement>('.vx-seg-item')[at];
      const w = btn?.offsetWidth ?? 0;
      const h = btn?.offsetHeight ?? 0;
      const x = btn?.offsetLeft ?? 0;
      const y = btn?.offsetTop ?? 0;
      setThumb((prev) => (w === 0 ? null : prev && prev.x === x && prev.y === y && prev.w === w && prev.h === h ? prev : { x, y, w, h }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [at, options.length]);
  return (
    <div
      ref={group}
      role="radiogroup"
      aria-label={label}
      className={cn('vx-seg', thumb && 'has-thumb', !!cols && 'is-grid')}
      style={cols ? ({ '--seg-cols': cols } as CSSProperties) : undefined}
    >
      {thumb && <span aria-hidden className="vx-seg-thumb" style={{ width: thumb.w, height: thumb.h, transform: `translate(${thumb.x}px, ${thumb.y}px)` }} />}
      {options.map((o, i) => (
        <button
          key={String(o.value)}
          ref={roving.ref(i)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          aria-label={o.title}
          title={o.title}
          tabIndex={roving.tabIndex(i)}
          onKeyDown={(e) => roving.onKeyDown(e, i)}
          onClick={() => onChange(o.value)}
          className="vx-seg-item"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Twenty marks, `share` of them lit: how much of a queue can be new artists. */
function ShareMarks({ share }: { share: number }) {
  const lit = Math.round(share * 20);
  return (
    <span className="vx-set-marks" aria-hidden>
      {Array.from({ length: 20 }, (_, i) => (
        <i key={i} className={i < lit ? 'is-on' : undefined} />
      ))}
    </span>
  );
}

/**
 * Two or three choices that each need a sentence: one card per option, a
 * radio group underneath (the name is the option's label; the sentence is
 * its description). `share` adds a 20-mark strip that shows the sentence's
 * number at a glance.
 */
export function ChoiceCards<T extends string>({
  label,
  value,
  options,
  onChange,
  idPrefix,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string; line: string; share?: number }>;
  onChange: (v: T) => void;
  idPrefix: string;
}) {
  const roving = useRovingChoice(options.map((o) => o.value), value, onChange);
  return (
    <div role="radiogroup" aria-label={label} className={cn('vx-set-choices', options.length === 3 ? 'is-3' : 'is-2')}>
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={roving.ref(i)}
          type="button"
          role="radio"
          aria-label={o.label}
          aria-checked={value === o.value}
          aria-describedby={`${idPrefix}-${o.value}`}
          tabIndex={roving.tabIndex(i)}
          onKeyDown={(e) => roving.onKeyDown(e, i)}
          onClick={() => onChange(o.value)}
          className="vx-set-choice"
        >
          <span className="vx-set-choice-head">
            <span className="vx-set-choice-title">{o.label}</span>
            <span className="vx-set-choice-radio" aria-hidden />
          </span>
          <span id={`${idPrefix}-${o.value}`} className="vx-set-choice-line">{o.line}</span>
          {o.share != null && <ShareMarks share={o.share} />}
        </button>
      ))}
    </div>
  );
}

/** A compact action pill at the right edge of a row. */
export function RowButton({ onClick, children, tone, disabled, label }: { onClick: () => void; children: ReactNode; tone?: 'danger' | 'danger-solid'; disabled?: boolean; label?: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} className={cn('vx-tap vx-set-btn', tone === 'danger' && 'is-danger', tone === 'danger-solid' && 'is-danger-solid')}>
      {children}
    </button>
  );
}

/** A labelled range with words at both ends (sentence case, not an eyebrow). */
export function RangeRow({ from, to, children }: { from: string; to: string; children: ReactNode }) {
  return (
    <div className="vx-set-range">
      <span aria-hidden>{from}</span>
      {children}
      <span aria-hidden>{to}</span>
    </div>
  );
}

/* -------------------------------------------------- sections and groups */

/** True once nothing in `ref` matches the active query (checked after the rows render). */
function useEmptyUnderQuery(ref: RefObject<HTMLElement | null>): boolean {
  const q = useContext(SettingsSearchCtx);
  const [empty, setEmpty] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setEmpty(!!q && !el.querySelector('[data-settings-row]'));
  }, [q, ref]);
  return empty;
}

export interface SectionDef {
  id: string;
  title: string;
  icon: ComponentType<{ className?: string }>;
}

/** The title and the one line of explanation every section opens with. */
export function SectionHead({ id, title, lede }: { id: string; title: string; lede?: string }) {
  const t = useT();
  return (
    <div className="vx-set-head">
      <h2 id={`${id}-title`} className="vx-set-title">{t(title)}</h2>
      {lede && <p className="vx-set-lede">{lede}</p>}
    </div>
  );
}

export function Section({ title, lede, id, children }: { title: string; lede?: string; id: string; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const empty = useEmptyUnderQuery(ref);
  const view = useContext(SettingsViewCtx);
  const q = useContext(SettingsSearchCtx);
  if (!sectionVisible(id, view, q)) return null;
  return (
    <section ref={ref} id={id} className={cn('vx-set-section', empty && 'hidden')} data-settings-section aria-labelledby={`${id}-title`}>
      <SectionHead id={id} title={title} lede={lede} />
      <div className="vx-set-rows">{children}</div>
    </section>
  );
}

/** A titled run of rows inside a section; collapses with its rows under search. */
export function Group({ title, icon, children }: { title?: string; icon?: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const empty = useEmptyUnderQuery(ref);
  const t = useT();
  return (
    <div ref={ref} className={cn('vx-set-group', empty && 'hidden')}>
      {title && (
        <h3 className="vx-set-sub">
          {icon}
          {t(title)}
        </h3>
      )}
      <div className="vx-set-rows">{children}</div>
    </div>
  );
}

/**
 * 1.18.2 — the theme choice as three small pictures of the app (window bar,
 * sidebar, a shelf, the play button) in each look: System is half and half,
 * split on the diagonal. The same radio group as Segmented (arrow keys move
 * the choice, one tab stop); the chosen card wears a green ring and a tick.
 */
export type ThemeChoice = 'system' | 'light' | 'dark';
const THEME_OPTIONS: Array<{ value: ThemeChoice; label: string; hint: string }> = [
  { value: 'system', label: 'System', hint: 'Follows your device' },
  { value: 'light', label: 'Light', hint: 'White panels' },
  { value: 'dark', label: 'Dark', hint: 'Black panels' },
];
export function ThemePicker({ value, onChange }: { value: ThemeChoice; onChange: (v: ThemeChoice) => void }) {
  const roving = useRovingChoice(THEME_OPTIONS.map((o) => o.value), value, onChange);
  return (
    <div role="radiogroup" aria-label="Theme" className="vx-theme-pick">
      {THEME_OPTIONS.map((o, i) => (
        <button
          key={o.value}
          ref={roving.ref(i)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          tabIndex={roving.tabIndex(i)}
          onKeyDown={(e) => roving.onKeyDown(e, i)}
          onClick={() => onChange(o.value)}
          className={cn('vx-theme-opt', `is-${o.value}`, value === o.value && 'is-on')}
        >
          <span className="vx-theme-thumb" aria-hidden>
            <span className="vx-theme-thumb-bar" />
            <span className="vx-theme-thumb-side" />
            <span className="vx-theme-thumb-main">
              <i /><i /><i />
            </span>
            <span className="vx-theme-thumb-play" />
          </span>
          <span className="vx-theme-opt-text">
            <span className="vx-theme-opt-label">{o.label}</span>
            <span className="vx-theme-opt-hint">{o.hint}</span>
          </span>
          <span className="vx-theme-opt-tick" aria-hidden><CheckIcon className="w-3.5 h-3.5" /></span>
        </button>
      ))}
    </div>
  );
}
