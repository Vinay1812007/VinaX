export type ThemePref = 'dark' | 'light' | 'system' | 'amoled' | 'auto';
export type ResolvedTheme = 'dark' | 'light' | 'amoled';

/** Resolve the user preference against the system scheme. Pure. */
export function resolveTheme(pref: ThemePref, systemPrefersDark: boolean, hour = new Date().getHours()): ResolvedTheme {
  if (pref === 'system') return systemPrefersDark ? 'dark' : 'light';
  // v5.12.0 — Auto: light through the day (07:00–18:59), dark at night.
  if (pref === 'auto') return hour >= 7 && hour < 19 ? 'light' : 'dark';
  return pref;
}

// ---------------------------------------------------------------------------
// 11.0 — app styles ("templates"): html[data-template] swaps palette, type,
// shape, navigation layout and motion (styles/templates/<id>.css). Only the
// ids and each style's page canvas live here, in first-load code; names and
// descriptions are in constants/templates.ts, loaded with Settings.
// ---------------------------------------------------------------------------

export type TemplateId = 'aura' | 'pulse' | 'sangam' | 'nocturne' | 'marquee' | 'vibe';
export const DEFAULT_TEMPLATE: TemplateId = 'aura';

/** The page canvas (= the style's --ink-900) per theme: [dark, light]. The
 *  pre-paint script in index.html carries the same table — keep in sync
 *  (asserted in templates.test.ts). AMOLED is black in every style. */
export const TEMPLATE_CANVAS: Record<TemplateId, readonly [string, string]> = {
  aura: ['#101116', '#f6f7fa'],
  pulse: ['#121212', '#f7f7f5'],
  sangam: ['#130e16', '#faf5ed'],
  nocturne: ['#0e0d22', '#f7f6fd'],
  marquee: ['#0c0c0d', '#f9f9f9'],
  vibe: ['#0a1619', '#f4fafa'],
};

/** Anything not in the table (an older build's id, damaged storage) → default. */
export function normalizeTemplate(id: unknown): TemplateId {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(TEMPLATE_CANVAS, id) ? (id as TemplateId) : DEFAULT_TEMPLATE;
}

/** Apply theme classes, the app style and the browser chrome colour. Idempotent.
 * Mirrored by the inline pre-paint script in index.html — keep in sync. */
export function applyThemeClasses(resolved: ResolvedTheme, root: HTMLElement = document.documentElement, template?: unknown): void {
  root.classList.toggle('light', resolved === 'light');
  root.classList.toggle('dark', resolved === 'dark' || resolved === 'amoled');
  root.classList.toggle('amoled', resolved === 'amoled');
  // A caller that passes no style keeps whatever is already on <html>.
  const tpl = normalizeTemplate(template ?? root.dataset.template);
  root.dataset.template = tpl;
  const bg = resolved === 'amoled' ? '#000000' : TEMPLATE_CANVAS[tpl][resolved === 'light' ? 1 : 0];
  // Also clear/replace the inline background the pre-paint script stamped on
  // <html>, so runtime theme switches don't leave a stale overscroll color.
  root.style.background = bg;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
}

// ---------------------------------------------------------------------------
// Adjustable iOS-style glass (Settings → Glass effect). Lives here rather
// than its own module: theme.ts is already in the first-load graph, and the
// 161KB budget has zero headroom for another module wrapper.
// Keep the formula in sync with the pre-paint script in index.html.
// ---------------------------------------------------------------------------

export const GLASS_DEFAULT = 40;
export const BLUR_DEFAULT = 40;

/** Map the 0–100 setting to --glass-alpha: 0 = classic solid (1.0), 100 =
 *  deepest glass (0.45) — never fully transparent, text needs its frost. */
export function glassAlpha(level: number): number {
  const safe = Number.isFinite(level) ? level : GLASS_DEFAULT;
  const l = Math.min(100, Math.max(0, Math.round(safe)));
  return Math.round((1 - 0.55 * (l / 100)) * 1000) / 1000;
}

/** Map the 0–100 blur setting to --glass-blur-boost (0..1) — independent
 *  from alpha so users can pick "sharp glass" or "hazy solid" freely. */
export function blurBoost(level: number): number {
  const safe = Number.isFinite(level) ? level : BLUR_DEFAULT;
  const l = Math.min(100, Math.max(0, Math.round(safe)));
  return Math.round((l / 100) * 1000) / 1000;
}

/** Apply glass alpha + blur boost to the document (no-op outside browser). */
export function applyGlassLevel(level: number, blur = BLUR_DEFAULT): void {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty('--glass-alpha', String(glassAlpha(level)));
  document.documentElement.style.setProperty('--glass-blur-boost', String(blurBoost(blur)));
}
