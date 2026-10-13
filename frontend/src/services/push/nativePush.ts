/**
 * Native Android push registration (FCM). Native platform only. Registers for
 * push, sends the device token to the server, and routes notification taps into
 * the app. This is what makes notifications arrive when the app is fully closed
 * (the WebView local-notification path only fires while the app is open).
 *
 * No-op unless: the app is a native build with @capacitor/push-notifications,
 * google-services.json is bundled, and the server has FCM_SERVICE_ACCOUNT set.
 *
 * 11.7.1 — the app is opened every day and the server had NOT ONE token: every
 * step here failed in silence (a missing plugin, a registration error, a
 * failed upload, a token that never came). Each of those is now reported to
 * Technical Monitoring as `push-native`, the upload is retried, and a token
 * that never arrives is reported too — so the next failure has a name.
 */
import { isNativePlatform } from '@/services/native';

const BASE = 'https://www.sirimillavinay.online';
/** How long `register()` may take to produce a token before that is reported. */
const TOKEN_WAIT_MS = 20_000;
let wired = false;
let tokenSeen = false;

function report(message: string): void {
  void import('@/services/analytics/telemetry').then((m) => m.reportError('push-native', message)).catch(() => undefined);
}

/** Upload the token; three tries with a growing pause. True once the server saved it. */
export async function uploadFcmToken(
  token: string,
  fetchImpl: typeof fetch = fetch,
  pause: (ms: number) => Promise<unknown> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<boolean> {
  let last = '';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetchImpl(`${BASE}/api/push/fcm-register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, platform: 'android', tzOffset: -new Date().getTimezoneOffset() }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (res.ok && body?.ok) return true;
      last = `fcm-register ${res.status}${body?.error ? ` ${body.error}` : ''}`;
      if (res.status === 400) break; // a malformed token will not get better
    } catch (e) {
      last = `fcm-register ${String(e).slice(0, 120)}`;
    }
    if (attempt < 2) await pause(2_000 * (attempt + 1));
  }
  report(last || 'fcm-register failed');
  return false;
}

type PushPlugin = typeof import('@capacitor/push-notifications').PushNotifications;

/** Where a tapped notification navigates; the app shell sets the router's navigate. */
let navigateTo: (to: string) => void = (to) => window.location.assign(to);

async function loadPlugin(): Promise<PushPlugin | null> {
  try {
    return (await import('@capacitor/push-notifications')).PushNotifications;
  } catch (e) {
    report(`plugin unavailable: ${String(e).slice(0, 120)}`);
    return null;
  }
}

async function wire(PushNotifications: PushPlugin): Promise<void> {
  if (wired) return;
  wired = true;
  // Device registered with FCM -> persist the token so the server can push.
  await PushNotifications.addListener('registration', (t) => {
    tokenSeen = true;
    void uploadFcmToken(t.value);
  });
  await PushNotifications.addListener('registrationError', (err) => {
    tokenSeen = true;
    report(`registration error: ${String((err as { error?: unknown })?.error ?? err).slice(0, 160)}`);
  });
  // Tap on a delivered notification -> deep-link into the app.
  await PushNotifications.addListener('pushNotificationActionPerformed', (e) => {
    const link = (e.notification.data as { link?: string } | undefined)?.link;
    if (typeof link === 'string' && link.startsWith('/')) navigateTo(link);
  });
}

async function registerToken(PushNotifications: PushPlugin): Promise<void> {
  tokenSeen = false;
  await PushNotifications.register();
  setTimeout(() => {
    if (!tokenSeen) report('no FCM token within 20 s of register()');
  }, TOKEN_WAIT_MS);
}

/** 11.7.2 — the OS notification permission, without asking. */
export type NativePermission = 'granted' | 'denied' | 'prompt' | 'unsupported';

export async function nativePushPermission(): Promise<NativePermission> {
  if (!isNativePlatform()) return 'unsupported';
  const PushNotifications = await loadPlugin();
  if (!PushNotifications) return 'unsupported';
  try {
    const r = (await PushNotifications.checkPermissions()).receive;
    return r === 'granted' ? 'granted' : r === 'denied' ? 'denied' : 'prompt';
  } catch {
    return 'unsupported';
  }
}

/**
 * 11.7.2 — the listener tapped "Turn on": ask the OS (Android shows its dialog
 * unless the listener has already refused it twice), then register.
 * 'denied' means Android will not ask again — only its Settings can turn it on.
 */
export async function enableNativePush(): Promise<'ok' | 'denied' | 'unsupported' | 'error'> {
  if (!isNativePlatform()) return 'unsupported';
  const PushNotifications = await loadPlugin();
  if (!PushNotifications) return 'unsupported';
  try {
    await wire(PushNotifications);
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive !== 'granted') perm = await PushNotifications.requestPermissions();
    if (perm.receive !== 'granted') return 'denied';
    await registerToken(PushNotifications);
    return 'ok';
  } catch (e) {
    report(`enable failed: ${String(e).slice(0, 160)}`);
    return 'error';
  }
}

/** App open: wire the listeners, ask once if Android has never asked, and register when allowed. */
export async function registerNativePush(navigate: (to: string) => void): Promise<void> {
  if (!isNativePlatform()) return;
  navigateTo = navigate;
  const PushNotifications = await loadPlugin();
  if (!PushNotifications) return;
  try {
    await wire(PushNotifications);
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
      perm = await PushNotifications.requestPermissions();
    }
    if (perm.receive !== 'granted') return; // the listener said no; Settings → Notifications can ask again
    await registerToken(PushNotifications);
  } catch (e) {
    report(`register failed: ${String(e).slice(0, 160)}`);
  }
}
