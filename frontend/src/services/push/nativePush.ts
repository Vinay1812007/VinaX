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
import { withNotificationPermission } from '@/services/native/permissions';
import { pushAuthHeaders } from '@/services/push/session';

const BASE = 'https://www.vinaxmusic.online';
/** How long `register()` may take to produce a token before that is reported. */
const TOKEN_WAIT_MS = 20_000;
let wired = false;
let tokenSeen = false;
/** True once this launch's token reached the server; resume re-registers until it does. */
let uploaded = false;
/** The token this launch received, so a sign-in can re-send it with the session (console rebuild). */
let lastToken = '';

/**
 * 13.7.3 — the Android channel every VinaX push uses. The server names it in
 * each message and the manifest names it as FCM's default
 * (backend _lib/fcm.ts FCM_CHANNEL_ID, scripts/patch-android.js). Created on
 * every start (Android keeps the first settings, so this is idempotent);
 * importance 4 = high, so a pick pops up instead of sitting silently in the tray.
 */
export const PUSH_CHANNEL = {
  id: 'vinax_picks',
  name: 'Song picks & news',
  description: 'Your daily song picks and messages from VinaX',
  importance: 4,
  visibility: 1,
  vibration: true,
  lights: true,
} as const;

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
        // Console rebuild — the session links this device to the signed-in Google account.
        headers: { 'content-type': 'application/json', ...pushAuthHeaders() },
        // 13.7.3 — lang too: without it every Android device fell outside the
        // console's language filter and the language-grouped song pick.
        body: JSON.stringify({ token, platform: 'android', lang: navigator.language || undefined, tzOffset: -new Date().getTimezoneOffset() }),
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

/**
 * The plugin comes back inside an object, never as the promise's value: a
 * Capacitor plugin is a Proxy that answers every property, `then` included, so
 * resolving a promise with it calls `PushNotifications.then()`, which rejects
 * with "not implemented on android" and leaves the await hanging forever —
 * push never registered (179 reports in App Errors).
 */
async function loadPlugin(): Promise<{ PushNotifications: PushPlugin } | null> {
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    return { PushNotifications };
  } catch (e) {
    report(`plugin unavailable: ${String(e).slice(0, 120)}`);
    return null;
  }
}

async function wire(PushNotifications: PushPlugin): Promise<void> {
  if (wired) return;
  wired = true;
  try {
    await PushNotifications.createChannel({ ...PUSH_CHANNEL });
  } catch (e) {
    report(`channel: ${String(e).slice(0, 120)}`);
  }
  // Device registered with FCM -> persist the token so the server can push.
  await PushNotifications.addListener('registration', (t) => {
    tokenSeen = true;
    lastToken = t.value;
    void uploadFcmToken(t.value).then((ok) => {
      if (ok) uploaded = true;
    });
  });
  await PushNotifications.addListener('registrationError', (err) => {
    tokenSeen = true;
    report(`registration error: ${String((err as { error?: unknown })?.error ?? err).slice(0, 160)}`);
  });
  // Tap on a delivered notification -> deep-link into the app.
  // Protocol-relative "//host/x" is refused: it would leave the app's origin.
  await PushNotifications.addListener('pushNotificationActionPerformed', (e) => {
    const data = e.notification.data as { link?: string; id?: string } | undefined;
    reportOpened(data?.id);
    const link = data?.link;
    if (typeof link === 'string') openPushLink(link);
  });
}

/** Where a tapped notification's link goes. Owner-console links (Smart
 *  Alerts) open the live console in the browser: the app has no /admin
 *  screen. Other same-site paths open inside the app; anything else
 *  (including protocol-relative "//host/x") is refused. */
export function openPushLink(link: string, navigate: (to: string) => void = navigateTo, open: (url: string) => void = (u) => { window.open(u, '_blank', 'noopener,noreferrer'); }): void {
  if (!/^\/(?!\/)/.test(link)) return;
  if (/^\/admin(\/|$|#|\?)/.test(link)) { open(`https://www.vinaxmusic.online${link}`); return; }
  navigate(link);
}

/** Console rebuild — count a tap on a console notification (its id only, nothing about the listener). */
export function reportOpened(id: unknown, fetchImpl: typeof fetch = fetch): void {
  const n = typeof id === 'string' && /^\d{1,15}$/.test(id) ? Number(id) : typeof id === 'number' ? id : NaN;
  if (!Number.isInteger(n) || n <= 0) return;
  void fetchImpl(`${BASE}/api/push/opened`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: n }) }).catch(() => undefined);
}

/** Console rebuild — signed in or out: send this launch's token again so the server links (or unlinks) the account. */
export async function relinkNativePush(): Promise<boolean> {
  if (!isNativePlatform() || !lastToken) return false;
  const ok = await uploadFcmToken(lastToken);
  if (ok) uploaded = true;
  return ok;
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
  const loaded = await loadPlugin();
  if (!loaded) return 'unsupported';
  const { PushNotifications } = loaded;
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
  const loaded = await loadPlugin();
  if (!loaded) return 'unsupported';
  const { PushNotifications } = loaded;
  try {
    await wire(PushNotifications);
    const granted = await withNotificationPermission(async (ask) => {
      let perm = await PushNotifications.checkPermissions();
      if (perm.receive !== 'granted') perm = (await ask(() => PushNotifications.requestPermissions())) ?? perm;
      return perm.receive === 'granted';
    }, true);
    if (!granted) return 'denied';
    await registerToken(PushNotifications);
    return 'ok';
  } catch (e) {
    report(`enable failed: ${String(e).slice(0, 160)}`);
    return 'error';
  }
}

/**
 * App open: wire the listeners and register when allowed. Never asks: the
 * "Allow access" sheet asks at start-up, after saying why.
 */
export async function registerNativePush(navigate: (to: string) => void): Promise<void> {
  if (!isNativePlatform()) return;
  navigateTo = navigate;
  const loaded = await loadPlugin();
  if (!loaded) return;
  const { PushNotifications } = loaded;
  try {
    await wire(PushNotifications);
    // Queued behind a dialog that is already up, so this reads its answer.
    const granted = await withNotificationPermission(async () => (await PushNotifications.checkPermissions()).receive === 'granted');
    if (!granted) return; // not allowed yet: the "Allow access" sheet or Settings → Notifications asks
    await registerToken(PushNotifications);
  } catch (e) {
    report(`register failed: ${String(e).slice(0, 160)}`);
  }
}

/**
 * 13.7.3 — back in the foreground: if this launch has no token on the server
 * yet (the permission was granted later in Android Settings, the upload failed
 * offline, or the first ask lost a race), register again. Never asks.
 */
export async function refreshNativePush(): Promise<void> {
  if (!isNativePlatform() || uploaded) return;
  const loaded = await loadPlugin();
  if (!loaded) return;
  const { PushNotifications } = loaded;
  try {
    await wire(PushNotifications);
    if ((await PushNotifications.checkPermissions()).receive !== 'granted') return;
    await registerToken(PushNotifications);
  } catch (e) {
    report(`refresh failed: ${String(e).slice(0, 160)}`);
  }
}
