/**
 * App style ("template"). 2.0 — VinaX has one look. 1.15 — black and green:
 * true-black window, #121212 panels, white type, a green play and green
 * active states, a player bar across the bottom. Always dark. The six styles
 * of 15.0–1.13 are gone; whatever id a listener had stored opens in this one
 * (utils/theme.ts, LEGACY_TEMPLATES).
 *
 * `id` maps 1:1 to `html[data-template='…']` and to a stylesheet in
 * src/styles/templates/<id>.css. The id and its page canvas live in
 * utils/theme.ts (first-load code); this module carries the name and the
 * swatch the style guide shows.
 */
import { DEFAULT_TEMPLATE, TEMPLATE_CANVAS, normalizeTemplate, type TemplateId } from '@/utils/theme';

export { DEFAULT_TEMPLATE, TEMPLATE_CANVAS, normalizeTemplate, type TemplateId };

export interface TemplateOption {
  id: TemplateId;
  label: string;
  /** One line that says what the look is. */
  tagline: string;
  /** What it is made of, for the docs. */
  traits: string;
  /** Swatches (dark look): canvas, raised surface, accent, secondary. */
  swatch: { canvas: string; raised: string; accent: string; second: string };
}

export const TEMPLATE_OPTIONS: readonly TemplateOption[] = [
  {
    id: 'vinax',
    label: 'VinaX',
    tagline: 'Black and green',
    traits: 'A black window with rounded #121212 panels, white type in Figtree, a green accent, 4px artwork, pill chips and buttons, a round green play, a player bar across the bottom.',
    swatch: { canvas: '#121212', raised: '#1f1f1f', accent: '#1ed760', second: '#b3b3b3' },
  },
];

export const TEMPLATE_IDS: readonly TemplateId[] = TEMPLATE_OPTIONS.map((t) => t.id);

export function templateOption(id: unknown): TemplateOption {
  const want = normalizeTemplate(id);
  return TEMPLATE_OPTIONS.find((t) => t.id === want) ?? TEMPLATE_OPTIONS[0];
}
