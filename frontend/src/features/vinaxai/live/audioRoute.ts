/**
 * VinaX AI Live voice — where the voice plays in the Android app: the
 * loudspeaker or the earpiece, like a phone call.
 *
 * Once the page opens the mic, Android's WebView puts the app's audio into
 * communication mode (that is what lets the phone's echo canceller work),
 * and Android then plays call audio through the earpiece unless the app
 * picks another device. The page cannot pick one (setSinkId does nothing in
 * the WebView), so the app carries a small native plugin, `VinaxAudioRoute`
 * (native-android/AudioRoutePlugin.java, registered in MainActivity by
 * scripts/patch-android.js).
 *
 * The plugin only exists in APKs built with it. On the web, and in an older
 * APK, `audioRouteAvailable()` is false and every call here is a no-op that
 * never throws, so Live voice works as before and the button stays hidden.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';

/** speaker · earpiece · headset (wired, USB or Bluetooth: Android's own choice) · other. */
export type AudioRoute = 'speaker' | 'earpiece' | 'headset' | 'other';

export interface RouteInfo {
  route: AudioRoute;
}

interface AudioRouteNative {
  /** Communication mode on, the voice on the loudspeaker (`speaker`) or earpiece; a connected headset wins. */
  start(opts: { speaker: boolean }): Promise<RouteInfo>;
  /** Switch between loudspeaker and earpiece during the call (also over a headset). */
  setSpeaker(opts: { on: boolean }): Promise<RouteInfo>;
  getRoute(): Promise<RouteInfo>;
  /** Back to normal: the device choice cleared and the mode restored. */
  stop(): Promise<void>;
}

export const AUDIO_ROUTE_PLUGIN = 'VinaxAudioRoute';

const native = registerPlugin<AudioRouteNative>(AUDIO_ROUTE_PLUGIN);

/** True only in an Android app built with the plugin (not on the web, not in an older APK). */
export function audioRouteAvailable(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable(AUDIO_ROUTE_PLUGIN);
  } catch {
    return false;
  }
}

const ROUTES: readonly AudioRoute[] = ['speaker', 'earpiece', 'headset', 'other'];
const clean = (r: unknown): AudioRoute | null => {
  const route = (r as Partial<RouteInfo> | null)?.route;
  return ROUTES.includes(route as AudioRoute) ? (route as AudioRoute) : null;
};

/** Start call routing; null when there is no plugin or it failed (the platform's routing stays). */
export async function startAudioRoute(speaker: boolean): Promise<AudioRoute | null> {
  if (!audioRouteAvailable()) return null;
  try {
    return clean(await native.start({ speaker }));
  } catch {
    return null;
  }
}

/** Switch the voice to the loudspeaker (`on`) or the earpiece; null when that failed. */
export async function setSpeaker(on: boolean): Promise<AudioRoute | null> {
  if (!audioRouteAvailable()) return null;
  try {
    return clean(await native.setSpeaker({ on }));
  } catch {
    return null;
  }
}

export async function stopAudioRoute(): Promise<void> {
  if (!audioRouteAvailable()) return;
  try {
    await native.stop();
  } catch {
    /* the app is closing or the plugin failed: nothing to restore from here */
  }
}
