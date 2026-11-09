/**
 * 1.12 — where VinaX is running, for the few places that must behave
 * differently on an iPhone or iPad in Safari (the web app, not the Android
 * app): the Web Audio effects chain goes quiet there with the screen off,
 * and there is no store app to offer — only Add to Home Screen.
 */
export function isIOSWeb(ua: string, maxTouchPoints: number, native: boolean): boolean {
  if (native) return false;
  // iPadOS reports a Mac user agent; touch points tell them apart.
  return /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && maxTouchPoints > 1);
}

let memo: boolean | null = null;

/** iPhone or iPad in a browser (or installed from Safari), worked out once. */
export function iosWeb(): boolean {
  if (memo !== null) return memo;
  if (typeof navigator === 'undefined') return false;
  const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  const native = typeof cap?.isNativePlatform === 'function' ? cap.isNativePlatform() : false;
  memo = isIOSWeb(navigator.userAgent, navigator.maxTouchPoints ?? 0, native);
  return memo;
}

/** Running from the Home Screen (standalone), on any platform. */
export function standaloneWeb(): boolean {
  if (typeof window === 'undefined') return false;
  return (navigator as Navigator & { standalone?: boolean }).standalone === true || (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches);
}
