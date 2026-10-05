/**
 * Accent themes for the revived Settings picker (roadmap O.4).
 *
 * `id` maps 1:1 to the `html[data-accent='…']` CSS blocks (dark) and their
 * `html.light[data-accent='…']` twins in src/styles/index.css. 'crimson' is
 * the historical default value every device migrated to in settings v2 — it
 * deliberately has NO CSS block and rides the :root ramp, so it stays the
 * safe default forever. Since 10.0 that ramp is Marigold, so the default is
 * shown as "Marigold". `dot` is the swatch color for the picker chip (the
 * accent's dark-mode ember-500, readable on both settings canvases).
 *
 * Ids are stored in settings and never change; only `label` is shown.
 * 'ember' (an older orange ramp) is labelled "Copper" so it does not read as
 * a second Marigold.
 */
export interface AccentOption {
  id: string;
  label: string;
  /** CSS color for the picker swatch. */
  dot: string;
}

export const ACCENT_OPTIONS: AccentOption[] = [
  { id: 'crimson', label: 'Marigold', dot: 'rgb(255 164 46)' },
  { id: 'ember', label: 'Copper', dot: 'rgb(240 146 46)' },
  { id: 'sunset', label: 'Sunset', dot: 'rgb(251 146 60)' },
  { id: 'gold', label: 'Gold', dot: 'rgb(234 179 8)' },
  { id: 'emerald', label: 'Emerald', dot: 'rgb(52 211 153)' },
  { id: 'ocean', label: 'Ocean', dot: 'rgb(56 189 248)' },
  { id: 'azure', label: 'Azure', dot: 'rgb(59 130 246)' },
  // 'aurora' (indigo) is omitted — it sits one shade from Violet below;
  // two identical-looking swatches would just confuse.
  { id: 'violet', label: 'Violet', dot: 'rgb(167 139 250)' },
  { id: 'rose', label: 'Rose', dot: 'rgb(251 113 133)' },
  { id: 'mono', label: 'Mono', dot: 'rgb(226 230 240)' },
];

/** Anything not in the list (old experiments, corrupt storage) → default. */
export function normalizeAccent(id: string | null | undefined): string {
  return ACCENT_OPTIONS.some((a) => a.id === id) ? (id as string) : 'crimson';
}
