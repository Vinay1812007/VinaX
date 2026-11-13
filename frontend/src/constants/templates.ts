/**
 * App style ("template"). 2.0 — VinaX has one look: the colours of the app
 * icon (deep plum, amber, pink), solid chrome, a player bar across the bottom.
 * The six styles of 15.0–1.13 are gone; whatever id a listener had stored
 * opens in this one (utils/theme.ts, LEGACY_TEMPLATES).
 *
 * `id` maps 1:1 to `html[data-template='…']` and to a stylesheet in
 * src/styles/templates/<id>.css. The id and its page canvas live in
 * utils/theme.ts (first-load code); this module carries the name and the
 * swatch other screens show (the accent picker's "Style colour" dot).
 *
 * The look sets a default accent; the accent picker still wins when the
 * listener has chosen one.
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
    tagline: 'Deep plum, amber and pink',
    traits: 'Plum-black bars, an amber accent with pink beside it, 10px artwork, pill chips and buttons, a round amber play, a solid player bar across the bottom.',
    swatch: { canvas: '#130e16', raised: '#251c2a', accent: '#ffa42e', second: '#ff6384' },
  },
];

export const TEMPLATE_IDS: readonly TemplateId[] = TEMPLATE_OPTIONS.map((t) => t.id);

export function templateOption(id: unknown): TemplateOption {
  const want = normalizeTemplate(id);
  return TEMPLATE_OPTIONS.find((t) => t.id === want) ?? TEMPLATE_OPTIONS[0];
}
