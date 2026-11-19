import { Capacitor, registerPlugin } from '@capacitor/core';

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
 * to be visible. 13.7.3: requests are queued so only one dialog shows per
 * launch (see ./permissions, loaded on demand to keep it out of first load).
 * `force` is for a tap the listener made (Settings, a toggle).
 *
 * Returns 'granted' | 'denied' | 'unsupported'.
 */
export async function ensureNotificationPermission(force = false): Promise<'granted' | 'denied' | 'unsupported'> {
  if (!isNativePlatform()) return 'unsupported';
  try {
    return await (await import('./permissions')).ensureNotificationPermission(force);
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

/**
 * 1.19.1 — the Android status bar's icons follow the app's look. Capacitor 8
 * draws the app edge to edge, so the bar sits over the app's own top bar:
 * white icons over the dark look, dark icons over the light one (its STYLE
 * names mean the background's shade: DARK = light icons). Core registers the
 * SystemBars plugin itself; a browser, or an older APK, simply ignores this.
 */
export function setSystemBarsStyle(theme: 'dark' | 'light'): void {
  if (!isNativePlatform()) return;
  try {
    const bars = registerPlugin<{ setStyle(o: { style: 'DARK' | 'LIGHT' }): Promise<void> }>('SystemBars');
    void bars.setStyle({ style: theme === 'dark' ? 'DARK' : 'LIGHT' }).catch(() => undefined);
  } catch {
    /* no such plugin on this build */
  }
}
