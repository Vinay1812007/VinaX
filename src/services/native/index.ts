import { Capacitor } from '@capacitor/core';

export const isNativePlatform = (): boolean => Capacitor.isNativePlatform();
export const isAndroid = (): boolean => Capacitor.getPlatform() === 'android';

/** 'android' | 'ios' | 'web' — used as the analytics device/platform label. */
export const platformName = (): string => Capacitor.getPlatform();

/** True when the native media-session plugin is compiled into this build. */
export const mediaSessionAvailable = (): boolean => Capacitor.isPluginAvailable('VinaxMedia');

function devLog(...args: unknown[]): void {
  if (import.meta.env.DEV) console.warn('[vinax:native]', ...args);
}

/**
 * Android 13+ requires POST_NOTIFICATIONS for the media playback notification
 * to be visible. We check + request via the LocalNotifications plugin (its
 * permission maps to the system notification permission).
 *
 * Returns 'granted' | 'denied' | 'unsupported'.
 */
export async function ensureNotificationPermission(): Promise<'granted' | 'denied' | 'unsupported'> {
  if (!isNativePlatform()) return 'unsupported';
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    let status = await LocalNotifications.checkPermissions();
    if (status.display !== 'granted') {
      status = await LocalNotifications.requestPermissions();
    }
    return status.display === 'granted' ? 'granted' : 'denied';
  } catch (err) {
    devLog('notification permission check failed', err);
    return 'unsupported';
  }
}

/** Read the current notification permission WITHOUT prompting. */
export async function getNotificationPermission(): Promise<'granted' | 'denied' | 'unsupported'> {
  if (!isNativePlatform()) return 'unsupported';
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const status = await LocalNotifications.checkPermissions();
    return status.display === 'granted' ? 'granted' : 'denied';
  } catch (err) {
    devLog('notification permission read failed', err);
    return 'unsupported';
  }
}

let launchAsked = false;

/** Ask once on app open; playback start re-checks (see playerStore). */
export async function requestNotificationPermissionOnce(): Promise<void> {
  if (launchAsked) return;
  launchAsked = true;
  await ensureNotificationPermission();
}

/**
 * Called when playback starts: if notifications are denied, the media
 * controls notification cannot appear — tell the user once how to fix it.
 */
let playbackChecked = false;

export async function checkNotificationOnFirstPlay(notify: (msg: string) => void): Promise<void> {
  if (!isNativePlatform() || playbackChecked) return;
  playbackChecked = true;
  const result = await ensureNotificationPermission();
  if (result === 'denied') {
    notify('Enable notifications in Android settings to get playback controls');
  }
}

/** Light haptic tick on key interactions (native only, fire-and-forget). */
export function haptic(style: 'light' | 'medium' = 'light'): void {
  if (!isNativePlatform()) return;
  try {
    // Lazy, sync read of the persisted setting to avoid a store import cycle.
    const raw = window.localStorage.getItem('vinax.settings.v1');
    if (raw && JSON.parse(raw)?.state?.haptics === false) return;
  } catch { /* default on */ }
  void (async () => {
    try {
      const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
      await Haptics.impact({ style: style === 'light' ? ImpactStyle.Light : ImpactStyle.Medium });
    } catch {
      /* ignore */
    }
  })();
}
