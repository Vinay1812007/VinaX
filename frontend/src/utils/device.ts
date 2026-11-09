/**
 * 1.12 — what this VinaX is running on, in the words a person would use:
 * "VinaX Android app · Android 14", "iPhone · Safari", "Windows · Chrome",
 * "Mac · Safari". Read once from the user agent; nothing is fetched. Used by
 * the Ideas & bugs popup so a report says where it came from without the
 * listener typing it, and by the owner console's inbox to tell platforms apart.
 */
export type DeviceOs = 'android' | 'ios' | 'ipados' | 'macos' | 'windows' | 'chromeos' | 'linux' | 'unknown';

export interface DeviceInfo {
  os: DeviceOs;
  /** "Android 14", "iPhone", "iPad", "Mac", "Windows", "ChromeOS", "Linux". */
  osName: string;
  /** "Chrome", "Safari", "Firefox", "Edge", "Samsung Internet", "Opera", or "" when unknown. */
  browser: string;
  /** True in the VinaX Android app (Capacitor). */
  app: boolean;
  form: 'phone' | 'tablet' | 'desktop';
  /** One line for people: "VinaX Android app · Android 14" / "Mac · Safari". */
  label: string;
}

export function describeDevice(ua: string, native: boolean, touchPoints = 0): DeviceInfo {
  const android = /Android\s?([\d.]+)?/i.exec(ua);
  const iphone = /iPhone|iPod/i.test(ua);
  const ipad = /iPad/i.test(ua) || (/Macintosh/i.test(ua) && touchPoints > 1);
  let os: DeviceOs = 'unknown';
  let osName = 'Unknown device';
  if (android) { os = 'android'; osName = android[1] ? `Android ${android[1].split('.')[0]}` : 'Android'; }
  else if (iphone) { os = 'ios'; osName = 'iPhone'; }
  else if (ipad) { os = 'ipados'; osName = 'iPad'; }
  else if (/Windows/i.test(ua)) { os = 'windows'; osName = 'Windows'; }
  else if (/CrOS/i.test(ua)) { os = 'chromeos'; osName = 'ChromeOS'; }
  else if (/Macintosh|Mac OS X/i.test(ua)) { os = 'macos'; osName = 'Mac'; }
  else if (/Linux/i.test(ua)) { os = 'linux'; osName = 'Linux'; }

  let browser = '';
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/SamsungBrowser/i.test(ua)) browser = 'Samsung Internet';
  else if (/OPR\/|Opera/i.test(ua)) browser = 'Opera';
  else if (/Firefox\/|FxiOS/i.test(ua)) browser = 'Firefox';
  else if (/CriOS/i.test(ua)) browser = 'Chrome';
  else if (/Chrome\//i.test(ua) && !/\bwv\b/.test(ua)) browser = 'Chrome';
  else if (/Safari\//i.test(ua)) browser = 'Safari';

  const form: DeviceInfo['form'] = os === 'ios' || (os === 'android' && /Mobile/i.test(ua)) ? 'phone' : os === 'ipados' || os === 'android' ? 'tablet' : 'desktop';
  const app = native && os === 'android';
  const label = app ? `VinaX Android app · ${osName}` : browser ? `${osName} · ${browser}` : osName;
  return { os, osName, browser, app, form, label };
}

let memo: DeviceInfo | null = null;

/** This device, worked out once. */
export function thisDevice(): DeviceInfo {
  if (memo) return memo;
  if (typeof navigator === 'undefined') return describeDevice('', false, 0);
  const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  const native = typeof cap?.isNativePlatform === 'function' ? cap.isNativePlatform() : false;
  memo = describeDevice(navigator.userAgent, native, navigator.maxTouchPoints ?? 0);
  return memo;
}
