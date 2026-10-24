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
 * 15.0 — the six styles were replaced (docs/app-styles.md). Each is modelled
 * on the design language of one kind of music app a listener already knows,
 * in VinaX's own names and colours; the ids of the 11.0–14.x styles map to
 * their replacements in utils/theme.ts (LEGACY_TEMPLATES).
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
    id: 'lumen',
    label: 'Lumen',
    tagline: 'Clean, editorial, big titles',
    traits: 'Black or white, a crimson accent, large section titles with a chevron, 8px artwork, a floating frosted mini player.',
    swatch: { canvas: '#0f0f11', raised: '#222226', accent: '#e0243f', second: '#ff7a3d' },
  },
  {
    id: 'verdant',
    label: 'Verdant',
    tagline: 'Black panels and a green accent',
    traits: 'Neutral black, flat grey panels, a filter row on Home, a two-column tile grid, square artwork, a tinted mini player.',
    swatch: { canvas: '#121212', raised: '#282828', accent: '#22d36a', second: '#509bf5' },
  },
  {
    id: 'monsoon',
    label: 'Monsoon',
    tagline: 'Charcoal, teal and saffron',
    traits: 'A teal band and a language row on Home, a wide banner hero, rounded tiles, a solid tab bar, an edge-to-edge mini player.',
    swatch: { canvas: '#1b1e21', raised: '#262a2e', accent: '#2cc6a8', second: '#ff9f1c' },
  },
  {
    id: 'harbour',
    label: 'Harbour',
    tagline: 'Deep navy, tall banners',
    traits: 'Navy black, a cyan accent, square corners, a tall banner hero with capitals, hairline rows, a solid bar player.',
    swatch: { canvas: '#0e1720', raised: '#17222d', accent: '#25c7d5', second: '#4f8df5' },
  },
  {
    id: 'verse',
    label: 'Verse',
    tagline: 'Lyrics first, coral and capsules',
    traits: 'Artwork bleeding over charcoal, a coral accent, a lyric line in the hero, capsule chips, a floating capsule player, springy motion.',
    swatch: { canvas: '#141418', raised: '#1f1f26', accent: '#ff4d6d', second: '#ffb84d' },
  },
  {
    id: 'onyx',
    label: 'Onyx',
    tagline: 'True black, white play, red marks',
    traits: 'Black, white as the accent, a row of mood chips on Home, overlines and "More" pills, square artwork, a full-width mini player.',
    swatch: { canvas: '#030303', raised: '#111111', accent: '#ffffff', second: '#ff2b3f' },
  },
];

export const TEMPLATE_IDS: readonly TemplateId[] = TEMPLATE_OPTIONS.map((t) => t.id);

export function templateOption(id: unknown): TemplateOption {
  const want = normalizeTemplate(id);
  return TEMPLATE_OPTIONS.find((t) => t.id === want) ?? TEMPLATE_OPTIONS[0];
}
