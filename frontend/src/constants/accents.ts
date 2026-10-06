/**
 * Accent themes for the Settings picker.
 *
 * `id` maps 1:1 to the `html[data-accent='…']` CSS blocks (dark) and their
 * `html.light[data-accent='…']` twins in src/styles/index.css. Ids are stored
 * in settings and never change; only `label` is shown.
 *
 * 'crimson' is the historical default every device migrated to in settings
 * v2. It deliberately has NO CSS block: since 11.0 it means "the app style's
 * own colour" (each style in styles/templates/ sets its accent only while the
 * accent is this default), so the picker shows it as "Style colour" with the
 * current style's swatch. 'marigold' is the 10.x default ramp under its own
 * id, so a listener can keep it in any style. 'ember' (an older orange ramp)
 * is labelled "Copper" so it does not read as a second Marigold.
 */
export interface AccentOption {
  id: string;
  label: string;
  /** CSS color for the picker swatch. */
  dot: string;
}

export const ACCENT_OPTIONS: AccentOption[] = [
  // The dot is replaced by the current style's accent in the picker.
  { id: 'crimson', label: 'Style colour', dot: 'rgb(110 142 255)' },
  { id: 'marigold', label: 'Marigold', dot: 'rgb(255 164 46)' },
  { id: 'ember', label: 'Copper', dot: 'rgb(214 120 78)' },
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
