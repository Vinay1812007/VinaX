import { useEffect } from 'react';
import { usePageTitle } from '@/hooks/usePageTitle';
import { TEMPLATE_OPTIONS } from '@/constants/templates';
import { ACCENT_OPTIONS } from '@/constants/accents';
import { FESTIVALS as ALL_FESTIVALS } from '@/constants/festivals';
import { Tabs, Switch, Card, Button } from '@/components/ui';
import { usePreview, type PreviewFestival } from '@/features/design/usePreview';
import { ColorSection, Section, ShapeSection, TypeSection } from '@/features/design/Foundations';
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

const FESTIVALS = [
  { id: 'none', label: 'No festival' },
  { id: 'diwali', label: 'Diwali' },
  { id: 'christmas', label: 'Christmas' },
] as const;

const NAV = [
  ['colour', 'Colour'],
  ['type', 'Type'],
  ['shape', 'Shape'],
  ['motion', 'Motion'],
  ['components', 'Components'],
  ['player', 'Player'],
  ['festivals', 'Festivals'],
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

function FestivalSection({ festival, onPick }: { festival: PreviewFestival; onPick: (f: PreviewFestival) => void }) {
  return (
    <Section
      id="festivals"
      title="Festival takeover"
      lead="During a festival the whole app changes: canvas, surfaces, text, accent, partner colour, the player's seek line, headings and the mark. Pick one here, or any of the 43 in the bar above, to see the takeover across this page and the app around it."
    >
      <div className="vx-ds-fest-pick">
        {FESTIVALS.map((f) => (
          <Card key={f.id} as="button" className="vx-ds-fest-card" data-fest={f.id} aria-pressed={festival === f.id} onClick={() => onPick(f.id)}>
            <span className="vx-ds-fest-swatch" aria-hidden />
            <strong>{f.label}</strong>
            <span>{f.id === 'none' ? 'The everyday look' : f.id === 'diwali' ? 'Lamp gold over a deep plum night' : 'Pine and berry with warm gold'}</span>
          </Card>
        ))}
      </div>
      <div className="vx-ds-fest-demo">
        <div className="vx-ds-mark">
          <img src="/icons/icon-192.png" alt="" width={64} height={64} />
          <span className="vx-ds-mark-ornament" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="vx-ds-overline">{festival === 'none' ? 'Tonight' : 'Festival special'}</p>
          <h3 className="vx-ds-fest-title">{festival === 'none' ? 'Good evening' : ALL_FESTIVALS.find((f) => f.id === festival)?.greeting ?? 'Happy festival'}</h3>
          <p className="vx-ds-fest-copy">The takeover is colour and CSS only: it costs nothing on first paint, and the moving sky still waits for the first touch.</p>
          <div className="vx-ds-row-demo mt-4">
            <Button>Play the festival mix</Button>
            <Button variant="secondary">See every festival</Button>
          </div>
        </div>
      </div>
    </Section>
  );
}

export default function DesignPage() {
  usePageTitle('Design system');
  useNoIndex();
  const [p, set] = usePreview();
  const version = `${p.theme}|${p.template}|${p.accent}|${p.festival}`; // re-measures contrast after the festival's stylesheet applies

  return (
    <div className="vx-ds">
      <header className="vx-ds-hero">
        <p className="vx-ds-overline">VinaX design system · v2</p>
        <h1>Every screen, one language.</h1>
        <p className="vx-ds-hero-lead">
          Tokens, type, motion and components for the rebuild. Use the bar below to see each one in every theme, app style, accent and festival. Nothing here changes your settings.
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
        <Tabs label="Festival" items={FESTIVALS} value={FESTIVALS.some((f) => f.id === p.festival) ? p.festival : 'none'} onChange={(festival: PreviewFestival) => set({ festival })} />
        <label className="vx-ds-select">
          <span>Any festival</span>
          <select value={p.festival} onChange={(e) => set({ festival: e.target.value })}>
            <option value="none">None</option>
            {ALL_FESTIVALS.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
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
      <FestivalSection festival={p.festival} onPick={(festival) => set({ festival })} />
    </div>
  );
}
