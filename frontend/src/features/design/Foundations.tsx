import { useEffect, useRef, useState } from 'react';

/** One section of the style guide: an anchor, a title and a one-line purpose. */
export function Section({ id, title, lead, children }: { id: string; title: string; lead: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="vx-ds-section">
      <header className="vx-ds-section-head">
        <h2 id={`${id}-h`}>{title}</h2>
        <p>{lead}</p>
      </header>
      {children}
    </section>
  );
}

export function Sub({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="vx-ds-sub">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Colour — every swatch is the live token, with its measured contrast.
// ---------------------------------------------------------------------------

function parseRgb(css: string): [number, number, number] | null {
  const m = css.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
function luminance([r, g, b]: [number, number, number]): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
/** WCAG contrast ratio of two CSS colours (opaque). */
export function contrast(a: string, b: string): number | null {
  const x = parseRgb(a);
  const y = parseRgb(b);
  if (!x || !y) return null;
  const [l1, l2] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (l1 + 0.05) / (l2 + 0.05);
}

const SURFACES = [
  ['--surface-0', 'Chrome'],
  ['--surface-1', 'Canvas'],
  ['--surface-2', 'Card'],
  ['--surface-3', 'Hover'],
  ['--surface-4', 'Pressed'],
] as const;
const TEXT = [
  ['--text-1', 'Titles'],
  ['--text-2', 'Body'],
  ['--text-3', 'Meta'],
  ['--text-4', 'Captions'],
  ['--accent-text', 'Accent text'],
] as const;
const ACCENTS = [
  ['--accent', 'Accent'],
  ['--accent-hover', 'Hover'],
  ['--accent-strong', 'Strong'],
  ['--accent-soft', 'Soft'],
  ['--accent-2', 'Partner'],
] as const;
const STATUS = [
  ['--positive', 'Positive'],
  ['--warning', 'Warning'],
  ['--danger', 'Danger'],
  ['--info', 'Info'],
] as const;

/** Re-measures whenever `version` changes (style preview). */
function useMeasured(version: string) {
  const ref = useRef<HTMLDivElement>(null);
  const [ratios, setRatios] = useState<Record<string, string>>({});
  useEffect(() => {
    // Wait a frame so the new classes on <html> have applied.
    const raf = requestAnimationFrame(() => {
      const root = ref.current;
      if (!root) return;
      const canvas = getComputedStyle(root).backgroundColor;
      const next: Record<string, string> = {};
      root.querySelectorAll<HTMLElement>('[data-ink]').forEach((el) => {
        const r = contrast(getComputedStyle(el).color, canvas);
        if (r) next[el.dataset.ink as string] = `${r.toFixed(1)}:1${r >= 7 ? ' AAA' : r >= 4.5 ? ' AA' : r >= 3 ? ' large' : ''}`;
      });
      setRatios(next);
    });
    return () => cancelAnimationFrame(raf);
  }, [version]);
  return { ref, ratios };
}

export function ColorSection({ version }: { version: string }) {
  const { ref, ratios } = useMeasured(version);
  return (
    <Section id="colour" title="Colour" lead="Semantic tokens over palette channels. One dark look: black panels, white type, one green.">
      <Sub title="Surfaces">
        <div className="vx-ds-swatches">
          {SURFACES.map(([t, name]) => (
            <figure key={t} className="vx-ds-swatch">
              <span className="vx-ds-chip" style={{ background: `var(${t})` }} />
              <figcaption><strong>{name}</strong><code>{t}</code></figcaption>
            </figure>
          ))}
        </div>
      </Sub>
      <Sub title="Text on the canvas">
        <div ref={ref} className="vx-ds-inks">
          {TEXT.map(([t, name]) => (
            <div key={t} className="vx-ds-ink">
              <span data-ink={t} style={{ color: `var(${t})` }}>Aa</span>
              <div><strong>{name}</strong><code>{t}</code></div>
              <span className="vx-ds-ratio">{ratios[t] ?? '—'}</span>
            </div>
          ))}
        </div>
      </Sub>
      <Sub title="Accent and status">
        <div className="vx-ds-swatches">
          {[...ACCENTS, ...STATUS].map(([t, name]) => (
            <figure key={t} className="vx-ds-swatch">
              <span className="vx-ds-chip vx-ds-chip--round" style={{ background: `var(${t})` }} />
              <figcaption><strong>{name}</strong><code>{t}</code></figcaption>
            </figure>
          ))}
          <figure className="vx-ds-swatch vx-ds-swatch--wide">
            <span className="vx-ds-chip" style={{ background: 'var(--accent-gradient)' }} />
            <figcaption><strong>The one gradient</strong><code>--accent-gradient</code></figcaption>
          </figure>
        </div>
      </Sub>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Type
// ---------------------------------------------------------------------------

const TYPE = [
  ['--type-hero', 'Hero', 'display', 'Music tuned to you'],
  ['--type-display', 'Display', 'display', 'Good evening'],
  ['--type-page', 'Page title', 'display', 'Your library'],
  ['--type-title-lg', 'Section', 'display', 'Made for you'],
  ['--type-title', 'Title', 'body', 'Queue settings'],
  ['--type-body-lg', 'Body large', 'body', 'Every song you play shapes what comes next.'],
  ['--type-body', 'Body', 'body', 'Listen together with friends, in sync, from anywhere.'],
  ['--type-meta', 'Meta', 'body', 'Anirudh Ravichander · 3:42'],
  ['--type-caption', 'Caption', 'body', 'Updated 2 minutes ago'],
  ['--type-overline', 'Overline', 'overline', 'Trending now'],
] as const;

export function TypeSection() {
  return (
    <Section id="type" title="Type" lead="Figtree for everything: heavy for titles, book weights for what you read. One scale, fluid at the top.">
      <div className="vx-ds-type">
        {TYPE.map(([t, name, face, sample]) => (
          <div key={t} className="vx-ds-type-row">
            <div className="vx-ds-type-meta"><strong>{name}</strong><code>{t}</code></div>
            <p className={`vx-ds-type-sample vx-ds-face-${face}`} style={{ fontSize: `var(${t})` }}>{sample}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Space, shape, elevation, materials
// ---------------------------------------------------------------------------

const SPACE = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16];
const RADII = ['xs', 'sm', 'md', 'lg', 'xl', '2xl', 'pill'];
const MATERIALS = [
  ['vx-mat-thin', 'Thin', 'Quiet panels: the sidebar'],
  ['vx-mat-regular', 'Regular', 'Floating controls over content'],
  ['vx-mat-chrome', 'Chrome', 'Bars content scrolls under'],
  ['vx-mat-thick', 'Thick', 'Menus, sheets, dialogs'],
] as const;

export function ShapeSection() {
  return (
    <Section id="shape" title="Space, shape and depth" lead="A 4-point grid, seven radii, four elevations and four glass materials. Settings › Glass and Blur drive the materials.">
      <Sub title="Space">
        <div className="vx-ds-space">
          {SPACE.map((n) => (
            <div key={n} className="vx-ds-space-row">
              <code>--space-{n}</code>
              <span style={{ width: `var(--space-${n})` }} />
            </div>
          ))}
        </div>
      </Sub>
      <Sub title="Radius">
        <div className="vx-ds-radii">
          {RADII.map((r) => (
            <figure key={r}>
              <span style={{ borderRadius: `var(--radius-${r})` }} />
              <figcaption><code>--radius-{r}</code></figcaption>
            </figure>
          ))}
        </div>
      </Sub>
      <Sub title="Elevation">
        <div className="vx-ds-elev">
          {[1, 2, 3, 4].map((n) => (
            <figure key={n} style={{ boxShadow: `var(--elev-${n})` }}>
              <figcaption><code>--elev-{n}</code></figcaption>
            </figure>
          ))}
        </div>
      </Sub>
      <Sub title="Glass materials">
        <div className="vx-ds-materials">
          <div className="vx-ds-materials-art" aria-hidden />
          {MATERIALS.map(([cls, name, use]) => (
            <div key={cls} className={`vx-ds-mat ${cls}`}>
              <strong>{name}</strong>
              <span>{use}</span>
            </div>
          ))}
        </div>
      </Sub>
    </Section>
  );
}
