import { useEffect } from 'react';
import { usePageTitle } from '@/hooks/usePageTitle';
import { TEMPLATE_OPTIONS } from '@/constants/templates';
import { ACCENT_OPTIONS } from '@/constants/accents';
import { Tabs, Switch } from '@/components/ui';
import { usePreview } from '@/features/design/usePreview';
import { ColorSection, ShapeSection, TypeSection } from '@/features/design/Foundations';
import { MotionSection, PlayerDemo } from '@/features/design/Motion';
import { ComponentsSection } from '@/features/design/Components';
import type { ResolvedTheme } from '@/utils/theme';
import '@/styles/pages/design.css';

/**
 * /design — the design system v2 style guide (README.md › Design system).
 * Not linked from anywhere, not in the sitemap, noindex (here and in
 * public/_headers), kept out of the service-worker precache (vite.config.ts
 * ON_DEMAND_PAGES). The preview bar changes only what <html> looks like
 * while the page is open; it never touches the listener's settings.
 */

const THEMES = [
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
  { id: 'amoled', label: 'Black' },
] as const;

const NAV = [
  ['colour', 'Colour'],
  ['type', 'Type'],
  ['shape', 'Shape'],
  ['motion', 'Motion'],
  ['components', 'Components'],
  ['player', 'Player'],
] as const;

function useNoIndex() {
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);
}

export default function DesignPage() {
  usePageTitle('Design system');
  useNoIndex();
  const [p, set] = usePreview();
  const version = `${p.theme}|${p.template}|${p.accent}`; // re-measures contrast when the look changes

  return (
    <div className="vx-ds">
      <header className="vx-ds-hero">
        <p className="vx-ds-overline">VinaX design system · v2</p>
        <h1>Every screen, one language.</h1>
        <p className="vx-ds-hero-lead">
          Tokens, type, motion and components for the rebuild. Use the bar below to see each one in every theme, app style and accent. Nothing here changes your settings.
        </p>
        <nav aria-label="Style guide sections" className="vx-ds-nav">
          {NAV.map(([id, label]) => (
            <a key={id} href={`#${id}`}>{label}</a>
          ))}
        </nav>
      </header>

      <div className="vx-ds-bar vx-mat-chrome" role="group" aria-label="Preview">
        <Tabs label="Theme" items={THEMES} value={p.theme} onChange={(theme: ResolvedTheme) => set({ theme })} />
        <label className="vx-ds-select">
          <span>Style</span>
          <select value={p.template} onChange={(e) => set({ template: e.target.value as typeof p.template })}>
            {TEMPLATE_OPTIONS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
        <label className="vx-ds-select">
          <span>Accent</span>
          <select value={p.accent} onChange={(e) => set({ accent: e.target.value })}>
            {ACCENT_OPTIONS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            {p.accent === 'custom' && <option value="custom">Custom</option>}
          </select>
        </label>
        <Switch className="vx-ds-bar-switch" checked={p.reduceMotion} onChange={(reduceMotion) => set({ reduceMotion })} label="Reduce motion" />
      </div>

      <ColorSection version={version} />
      <TypeSection />
      <ShapeSection />
      <MotionSection />
      <ComponentsSection />
      <PlayerDemo />
    </div>
  );
}
