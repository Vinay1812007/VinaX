export type ThemePref = 'dark' | 'light' | 'system' | 'amoled';
export type ResolvedTheme = 'dark' | 'light' | 'amoled';

/** Resolve the user preference against the system scheme. Pure. */
export function resolveTheme(pref: ThemePref, systemPrefersDark: boolean): ResolvedTheme {
  if (pref === 'system') return systemPrefersDark ? 'dark' : 'light';
  return pref;
}

/** Apply theme classes + browser chrome color. Idempotent.
 * Mirrored by the inline pre-paint script in index.html — keep in sync. */
export function applyThemeClasses(resolved: ResolvedTheme, root: HTMLElement = document.documentElement): void {
  root.classList.toggle('light', resolved === 'light');
  root.classList.toggle('dark', resolved === 'dark' || resolved === 'amoled');
  root.classList.toggle('amoled', resolved === 'amoled');
  const bg = resolved === 'light' ? '#f0f2f7' : resolved === 'amoled' ? '#000000' : '#0b0c18';
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
