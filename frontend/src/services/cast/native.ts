/**
 * Google Cast in the Android app: the VinaxCast plugin
 * (native-android/VinaxCastPlugin.java) behind the same CastTransport the
 * web SDK uses, so the cast store, the player's intercepts and the silent
 * local clock work the same on both. Loaded when "Connect to a device" first
 * opens (services/cast ensureCastSdk), never at start or in the first load.
 *
 * An app built before the plugin has no "VinaxCast": nothing happens and
 * casting stays hidden, as before. So does a phone without Google Play
 * services (the plugin answers { available: false }).
 */
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { useCastStore, setCastTransport, type CastMedia, type CastTransport } from './index';
import { castSessionStarted, castSessionEnded, castRemoteTime, castRemotePlaying } from './session';

export const CAST_PLUGIN = 'VinaxCast';

interface CastInfo {
  available: boolean;
  devices: boolean;
  connected: boolean;
  deviceName?: string;
}

export interface CastStatus {
  state: 'playing' | 'paused' | 'buffering' | 'loading' | 'idle' | 'unknown';
  idleReason?: string;
  position: number;
  duration: number;
  url?: string;
}

interface CastNative {
  init(): Promise<CastInfo>;
  showDevicePicker(): Promise<void>;
  loadMedia(opts: CastMedia & { startTime: number; autoplay: boolean }): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seek(opts: { position: number }): Promise<void>;
  setVolume(opts: { level: number }): Promise<void>;
  endSession(): Promise<void>;
  addListener(event: 'availability', fn: (e: { devices: boolean }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'session', fn: (e: { connected: boolean; deviceName?: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'status', fn: (e: CastStatus) => void): Promise<PluginListenerHandle>;
}

const quiet = (p: Promise<unknown>): void => void p.catch(() => undefined);

export function nativeTransport(plugin: CastNative): CastTransport {
  return {
    load: (media, opts) => plugin.loadMedia({ ...media, ...opts }),
    setPlaying: (play) => quiet(play ? plugin.play() : plugin.pause()),
    seek: (seconds) => quiet(plugin.seek({ position: seconds })),
    setVolume: (level) => quiet(plugin.setVolume({ level })),
    requestSession: () => quiet(plugin.showDevicePicker()),
  };
}

/** A receiver report: the seek bar, and the phone's clock following a pause or seek on the TV. */
export function onNativeStatus(s: CastStatus): void {
  if (s.state === 'playing' || s.state === 'paused') {
    castRemotePlaying(s.state === 'playing', s.url);
    castRemoteTime(s.position, s.url, s.state === 'playing');
  }
}

let started: Promise<void> | null = null;

/** Start Cast once. Safe to call again (the device sheet opening calls it too). */
export function startNativeCast(plugin?: CastNative): Promise<void> {
  if (!started) started = start(plugin).catch(() => undefined);
  return started;
}

async function start(given?: CastNative): Promise<void> {
  if (!given && !Capacitor.isPluginAvailable(CAST_PLUGIN)) return;
  const plugin = given ?? registerPlugin<CastNative>(CAST_PLUGIN);
  const transport = nativeTransport(plugin);
  // Listeners first, so a session the TV kept from last time is not missed.
  await plugin.addListener('availability', (e) => useCastStore.setState({ nearby: !!e.devices }));
  await plugin.addListener('session', (e) => {
    const was = useCastStore.getState().connected;
    if (e.connected && !was) {
      // A session means the framework is up, even if init's answer is still on its way.
      setCastTransport(transport);
      castSessionStarted(e.deviceName ?? null);
    } else if (!e.connected && was) castSessionEnded();
  });
  await plugin.addListener('status', onNativeStatus);
  const info = await plugin.init();
  if (!info.available) return;
  setCastTransport(transport);
  useCastStore.setState({ available: true, native: true, nearby: !!info.devices });
  if (info.connected && !useCastStore.getState().connected) castSessionStarted(info.deviceName ?? null);
}
