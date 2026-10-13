import { useRef, type KeyboardEvent } from 'react';
import { TEMPLATE_OPTIONS, type TemplateId } from '@/constants/templates';
import { isNativePlatform } from '@/services/native';

/**
 * 11.0 — the app style picker: six looks as one radio group (arrow keys move
 * the choice). Each card carries a small drawn preview of that style — its
 * canvas, artwork shape, play button, mini player and tab bar — so the choice
 * can be made by eye. The preview is CSS only (settings.css, `.vx-tpl-*`),
 * coloured from the style's own swatch, so it looks the same whichever style
 * is on.
 */
/**
 * Switch styles as one cross-fade of the whole page where the browser can
 * (View Transitions); elsewhere the change is immediate. The attribute is
 * stamped inside the transition so the "after" snapshot is the new style —
 * the layout effect that normally applies it runs a frame later.
 *
 * 13.0.2 — the cross-fade is DESKTOP-ONLY. On the Android app (and phones
 * generally) a View Transition snapshots the whole page, and snapshots do
 * not carry `backdrop-filter`: every glass surface captured as a see-through
 * void, so the UI looked EMPTY for the length of the fade, and snapshotting
 * a blur-heavy page janked hard on phone GPUs. Phones take the instant path.
 */
function wantsCrossfade(root: HTMLElement): boolean {
  if (isNativePlatform()) return false;
  if (root.classList.contains('reduce-motion')) return false;
  const mm = window.matchMedia?.bind(window);
  if (mm?.('(prefers-reduced-motion: reduce)').matches) return false;
  // Coarse primary pointer = phone/tablet: same snapshot artifacts as the app.
  if (mm?.('(pointer: coarse)').matches) return false;
  return true;
}

/** Instant switch: suspend every colour/shadow transition for the swap, so
 *  the page snaps to the new style in one frame instead of hundreds of
 *  elements tweening background/border for 400ms — the other half of the
 *  "laggy" switch on low-end phones. Transitions return two frames later,
 *  once the new style has laid out. */
function applyInstant(id: TemplateId, apply: (id: TemplateId) => void): void {
  const root = document.documentElement;
  root.classList.add('tpl-switching');
  apply(id);
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('tpl-switching')));
}

function switchStyle(id: TemplateId, apply: (id: TemplateId) => void): void {
  const root = document.documentElement;
  const start = (document as Document & { startViewTransition?: (cb: () => void) => unknown }).startViewTransition;
  if (typeof start !== 'function' || !wantsCrossfade(root)) {
    applyInstant(id, apply);
    return;
  }
  start.call(document, () => {
    root.dataset.template = id;
    apply(id);
  });
}

/** The element that scrolls `el` (the page itself when no ancestor does). */
function scrollerOf(el: HTMLElement): HTMLElement {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

/**
 * 13.0 — each style has its own type scale and spacing, so the content above
 * the picker changes height and the card that was just tapped used to jump
 * (up to ~40 px) under the finger. Hold it where it was: measure before the
 * switch, then scroll by the difference once the new style has laid out (and
 * again after the cross-fade, which lays out late).
 */
function keepInPlace(el: HTMLElement | null | undefined): void {
  if (!el) return;
  const top = el.getBoundingClientRect().top;
  const scroller = scrollerOf(el);
  const settle = (): void => {
    if (!el.isConnected) return;
    const d = el.getBoundingClientRect().top - top;
    if (Math.abs(d) >= 1) scroller.scrollBy({ top: d, behavior: 'instant' as ScrollBehavior });
  };
  requestAnimationFrame(() => requestAnimationFrame(settle));
  setTimeout(settle, 350);
}

export function TemplatePicker({ value, onChange: commit }: { value: TemplateId; onChange: (id: TemplateId) => void }) {
  const onChange = (id: TemplateId): void => {
    if (id === value) return;
    keepInPlace(refs.current[ids.indexOf(id)]);
    switchStyle(id, commit);
  };
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const ids = TEMPLATE_OPTIONS.map((t) => t.id);
  const move = (e: KeyboardEvent, i: number): void => {
    const last = ids.length - 1;
    const next = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i === last ? 0 : i + 1) : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (i === 0 ? last : i - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? last : -1;
    if (next < 0) return;
    e.preventDefault();
    onChange(ids[next]);
    refs.current[next]?.focus();
  };
  const chosen = TEMPLATE_OPTIONS.find((t) => t.id === value) ?? TEMPLATE_OPTIONS[0];
  return (
    <>
      <div className="vx-tpl-grid" role="radiogroup" aria-label="App style">
        {TEMPLATE_OPTIONS.map((t, i) => {
          const on = t.id === value;
          return (
            <button
              key={t.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              data-tpl={t.id}
              onClick={() => onChange(t.id)}
              onKeyDown={(e) => move(e, i)}
              className="vx-tpl-card"
              style={{ '--tpl-c': t.swatch.canvas, '--tpl-s': t.swatch.raised, '--tpl-a': t.swatch.accent, '--tpl-b': t.swatch.second } as React.CSSProperties}
            >
              <span className="vx-tpl-preview" aria-hidden>
                <span className="vx-tpl-title" />
                <span className="vx-tpl-arts"><i /><i /><i /></span>
                <span className="vx-tpl-lines"><i /><i /></span>
                <span className="vx-tpl-mini"><i /><b /></span>
                <span className="vx-tpl-dock"><i /><i /><i /><i /></span>
              </span>
              <span className="vx-tpl-name">{t.label}</span>
              <span className="vx-tpl-tag">{t.tagline}</span>
            </button>
          );
        })}
      </div>
      <p className="vx-set-swatch-name" aria-live="polite"><b>{chosen.label}</b> · {chosen.traits}</p>
    </>
  );
}
