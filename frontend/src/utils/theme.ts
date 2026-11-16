// ---------------------------------------------------------------------------
// App style ("template"): html[data-template] names the look the stylesheets
// in styles/templates/ are written for. 2.0 — VinaX has ONE look, `vinax`.
// 1.15 — and one theme: black and green, always dark (no light, black or
// auto theme, no accent picker).
// The id, the setting and the pre-paint stamp stay, so a second look can be
// added the way README.md (Adding an app style) describes.
// ---------------------------------------------------------------------------

export type TemplateId = 'vinax';
export const DEFAULT_TEMPLATE: TemplateId = 'vinax';

/** The page canvas (= the style's --ink-900). The pre-paint script in
 *  index.html carries the same table — keep in sync (asserted in
 *  templates.test.ts). */
export const TEMPLATE_CANVAS: Record<TemplateId, string> = {
  vinax: '#121212',
};

/** 2.0 — every style id an earlier release stored (the six of 15.0–1.13 and
 *  the six of 11.0–14.x) opens in the one look. Settings and backups that
 *  carry one of these are rewritten to `vinax` by the settings sanitiser. */
export const LEGACY_TEMPLATES: Readonly<Record<string, TemplateId>> = {
  lumen: 'vinax',
  verdant: 'vinax',
  monsoon: 'vinax',
  harbour: 'vinax',
  verse: 'vinax',
  onyx: 'vinax',
  aura: 'vinax',
  pulse: 'vinax',
  sangam: 'vinax',
  nocturne: 'vinax',
  vibe: 'vinax',
  marquee: 'vinax',
};

/** Anything not in the table (an older build's id, damaged storage) → default. */
export function normalizeTemplate(id: unknown): TemplateId {
  if (typeof id !== 'string') return DEFAULT_TEMPLATE;
  if (Object.prototype.hasOwnProperty.call(TEMPLATE_CANVAS, id)) return id as TemplateId;
  if (Object.prototype.hasOwnProperty.call(LEGACY_TEMPLATES, id)) return LEGACY_TEMPLATES[id];
  return DEFAULT_TEMPLATE;
}

/** Apply the dark class, the app style and the browser chrome colour. Idempotent.
 * Mirrored by the inline pre-paint script in index.html — keep in sync. */
export function applyThemeClasses(root: HTMLElement = document.documentElement, template?: unknown): void {
  root.classList.remove('light', 'amoled');
  root.classList.add('dark');
  // A caller that passes no style keeps whatever is already on <html>.
  const tpl = normalizeTemplate(template ?? root.dataset.template);
  root.dataset.template = tpl;
  const bg = TEMPLATE_CANVAS[tpl];
  root.style.background = bg;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
}

// ---------------------------------------------------------------------------
// Adjustable glass (Settings → Glass effect). Lives here rather than in its
// own module: theme.ts is already in the first-load graph, and the first-load
// budget (scripts/check-bundle-size.mjs) has little room for another wrapper.
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
