/**
 * 11.0 — app styles ("templates"). One choice in Settings → Appearance swaps
 * the whole look and feel of VinaX: palette, type, shapes, the navigation and
 * mini-player layout, card treatment and motion.
 *
 * `id` maps 1:1 to `html[data-template='…']` and to a stylesheet in
 * src/styles/templates/<id>.css. Ids are stored in settings and never change;
 * only `label` is shown. The ids and each style's page canvas live in
 * utils/theme.ts (first-load code); this module is the picker's copy and is
 * only loaded with Settings.
 *
 * A template sets a default accent; the accent picker still wins when the
 * listener has chosen one, and a festival skin repaints the colours of any
 * template while it is on (the layout stays).
 */
import { DEFAULT_TEMPLATE, TEMPLATE_CANVAS, normalizeTemplate, type TemplateId } from '@/utils/theme';

export { DEFAULT_TEMPLATE, TEMPLATE_CANVAS, normalizeTemplate, type TemplateId };

export interface TemplateOption {
  id: TemplateId;
  label: string;
  /** One line under the name in the picker. */
  tagline: string;
  /** What changes, for the picker's detail line and the docs. */
  traits: string;
  /** Picker swatches (dark look): canvas, raised surface, accent, secondary. */
  swatch: { canvas: string; raised: string; accent: string; second: string };
}

export const TEMPLATE_OPTIONS: readonly TemplateOption[] = [
  {
    id: 'aura',
    label: 'Aura',
    tagline: 'Clean glass and large titles',
    traits: 'Cool graphite, an iris accent, big left-aligned titles, frosted bars, soft rounded artwork.',
    swatch: { canvas: '#101116', raised: '#202329', accent: '#6e8eff', second: '#40d6be' },
  },
  {
    id: 'pulse',
    label: 'Pulse',
    tagline: 'Dense, flat and fast',
    traits: 'Neutral black, a volt accent, compact bold titles, tight corners, a solid bar player, no glass.',
    swatch: { canvas: '#121212', raised: '#242424', accent: '#c8f53c', second: '#a882ff' },
  },
  {
    id: 'sangam',
    label: 'Sangam',
    tagline: 'Warm, roomy and colourful',
    traits: 'Plum and marigold, warm serif titles, big rounded cards, colourful tiles, a floating tab bar.',
    swatch: { canvas: '#130e16', raised: '#251c2a', accent: '#ffa42e', second: '#26c6ba' },
  },
  {
    id: 'nocturne',
    label: 'Nocturne',
    tagline: 'Midnight gradients and glow',
    traits: 'Deep indigo, an orchid accent, lighter titles, gradient headers, glowing play buttons.',
    swatch: { canvas: '#0e0d22', raised: '#201d40', accent: '#b484ff', second: '#46d2ff' },
  },
  {
    id: 'marquee',
    label: 'Marquee',
    tagline: 'Black canvas, picture first',
    traits: 'True black, an ice accent, tall cinema-sign titles, wide picture cards, square corners.',
    swatch: { canvas: '#0c0c0d', raised: '#222225', accent: '#2ed0f0', second: '#ff7a59' },
  },
  {
    id: 'vibe',
    label: 'Vibe',
    tagline: 'Immersive, bubbly and bold',
    traits: 'Deep teal, a coral accent, round bubbly titles, extra-round shapes, a capsule player.',
    swatch: { canvas: '#0a1619', raised: '#182c31', accent: '#ff7868', second: '#ffcc48' },
  },
];

export const TEMPLATE_IDS: readonly TemplateId[] = TEMPLATE_OPTIONS.map((t) => t.id);

export function templateOption(id: unknown): TemplateOption {
  const want = normalizeTemplate(id);
  return TEMPLATE_OPTIONS.find((t) => t.id === want) ?? TEMPLATE_OPTIONS[0];
}
