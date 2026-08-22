export type ThemePref = 'dark' | 'light' | 'system' | 'amoled';
export type ResolvedTheme = 'dark' | 'light' | 'amoled';

/** Resolve the user preference against the system scheme. Pure. */
export function resolveTheme(pref: ThemePref, systemPrefersDark: boolean): ResolvedTheme {
  if (pref === 'system') return systemPrefersDark ? 'dark' : 'light';
  return pref;
}

/** Apply theme classes + browser chrome color. Idempotent. */
export function applyThemeClasses(resolved: ResolvedTheme, root: HTMLElement = document.documentElement): void {
  root.classList.toggle('light', resolved === 'light');
  root.classList.toggle('dark', resolved === 'dark' || resolved === 'amoled');
  root.classList.toggle('amoled', resolved === 'amoled');
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', resolved === 'light' ? '#eef2f8' : resolved === 'amoled' ? '#000000' : '#0b0c18');
}
