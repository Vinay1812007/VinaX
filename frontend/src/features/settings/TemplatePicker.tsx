import { useRef, type KeyboardEvent } from 'react';
import { TEMPLATE_OPTIONS, type TemplateId } from '@/constants/templates';

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
 * (View Transitions); elsewhere, and under either reduced-motion switch, the
 * change is immediate. The attribute is stamped inside the transition so the
 * "after" snapshot is the new style — the layout effect that normally applies
 * it runs a frame later.
 */
function switchStyle(id: TemplateId, apply: (id: TemplateId) => void): void {
  const root = document.documentElement;
  const start = (document as Document & { startViewTransition?: (cb: () => void) => unknown }).startViewTransition;
  const still = root.classList.contains('reduce-motion') || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (typeof start !== 'function' || still) {
    apply(id);
    return;
  }
  start.call(document, () => {
    root.dataset.template = id;
    apply(id);
  });
}

export function TemplatePicker({ value, onChange: commit }: { value: TemplateId; onChange: (id: TemplateId) => void }) {
  const onChange = (id: TemplateId): void => {
    if (id !== value) switchStyle(id, commit);
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
