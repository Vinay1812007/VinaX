/**
 * Browser push-notification opt-in. Subscribes this device to Web Push and
 * registers the subscription with the backend (/api/push/*). Requires the
 * server VAPID_* env vars. No-ops gracefully where push is unsupported.
 *
 * 11.7.1 — "nobody gets notifications": the console showed 0 subscribed
 * devices while listeners had said yes. Three holes, all closed here:
 *  1. The browser's own subscription was taken as proof of being subscribed.
 *     A server row that was never saved (a 504 on the key, a failed write),
 *     or was cleared later (production reset, 404/410 clean-up), left the
 *     device "on" forever and it never registered again. A device now counts
 *     as subscribed only once the SERVER has confirmed this exact endpoint.
 *  2. Nothing re-registered on app open, although the reset script promised
 *     it. `syncPush()` now re-sends a granted device's subscription at most
 *     once a day, and at once when it was never confirmed.
 *  3. A rotated VAPID key made `pushManager.subscribe` throw for every
 *     existing subscriber. A subscription for another key is now replaced.
 * Every failure is reported to Technical Monitoring instead of vanishing.
 */

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** Where the server's confirmation of this device's endpoint is kept. */
export const PUSH_CONFIRM_KEY = 'vinax.push.confirmed.v1';
/** How often a granted device re-sends its subscription. */
export const PUSH_RESYNC_MS = 24 * 3_600_000;

interface Confirmation {
  endpoint: string;
  at: number;
}

function readConfirmation(): Confirmation | null {
  try {
    const raw = JSON.parse(localStorage.getItem(PUSH_CONFIRM_KEY) ?? 'null') as Partial<Confirmation> | null;
    return raw && typeof raw.endpoint === 'string' && typeof raw.at === 'number' ? { endpoint: raw.endpoint, at: raw.at } : null;
  } catch {
    return null;
  }
}

function writeConfirmation(c: Confirmation | null): void {
  try {
    if (c) localStorage.setItem(PUSH_CONFIRM_KEY, JSON.stringify(c));
    else localStorage.removeItem(PUSH_CONFIRM_KEY);
  } catch {
    /* storage is optional; the next open simply re-sends */
  }
}

function report(message: string): void {
  void import('@/services/analytics/telemetry').then((m) => m.reportError('push-web', message)).catch(() => undefined);
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    // `ready` never settles when no worker is registered; do not hang the UI on it.
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 10_000)),
    ]);
  } catch {
    return null;
  }
}

export function decodeKey(base64: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const normal = (base64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normal);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

/** The server's public key. Two tries: one 504 used to end the opt-in for good. */
async function vapidKey(): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch('/api/push/vapid', { cache: 'no-store' });
      if (res.ok) {
        const data = (await res.json()) as { key?: string | null };
        if (data.key) return data.key;
        report('server has no VAPID key');
        return null;
      }
      if (attempt === 1) report(`vapid ${res.status}`);
    } catch (e) {
      if (attempt === 1) report(`vapid ${String(e).slice(0, 120)}`);
    }
    await new Promise((r) => setTimeout(r, 1_500));
  }
  return null;
}

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a) return false;
  const x = new Uint8Array(a);
  if (x.length !== b.length) return false;
  for (let i = 0; i < x.length; i += 1) if (x[i] !== b[i]) return false;
  return true;
}

/** This device's subscription for the CURRENT server key (an old key's subscription is replaced). */
async function ensureSubscription(reg: ServiceWorkerRegistration, key: string): Promise<PushSubscription> {
  const appKey = decodeKey(key);
  const existing = await reg.pushManager.getSubscription();
  if (existing) {
    if (sameKey(existing.options?.applicationServerKey, appKey)) return existing;
    await existing.unsubscribe().catch(() => false);
  }
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });
}

/** Hand the subscription to the server; true only when it says it saved it. */
async function saveOnServer(sub: PushSubscription, lang?: string, at = Date.now()): Promise<boolean> {
  const data = sub.toJSON();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // tzOffset (minutes east of UTC) powers the server's quiet-hours gate,
        // so nobody is pushed at 3am local. Coarse and non-identifying.
        body: JSON.stringify({ endpoint: data.endpoint, keys: data.keys, lang, tzOffset: -new Date().getTimezoneOffset() }),
      });
      const saved = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (saved?.ok) {
        writeConfirmation({ endpoint: sub.endpoint, at });
        return true;
      }
      // A refusal (bad endpoint) will not change on a retry.
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        report(`subscribe ${res.status} ${saved?.error ?? ''}`.trim());
        return false;
      }
      if (attempt === 1) report(`subscribe ${res.status}`);
    } catch (e) {
      if (attempt === 1) report(`subscribe ${String(e).slice(0, 120)}`);
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  return false;
}

/** Subscribed means: the browser holds a subscription AND the server confirmed that same endpoint. */
export async function isPushSubscribed(): Promise<boolean> {
  if (!pushSupported()) return false;
  const reg = await registration();
  if (!reg) return false;
  const sub = await reg.pushManager.getSubscription().catch(() => null);
  if (!sub) return false;
  return readConfirmation()?.endpoint === sub.endpoint;
}

export type EnablePushResult = 'ok' | 'denied' | 'unsupported' | 'error';

export async function enablePush(lang?: string): Promise<EnablePushResult> {
  if (!pushSupported()) return 'unsupported';
  let permission: NotificationPermission;
  try {
    permission = await Notification.requestPermission();
  } catch {
    return 'error';
  }
  if (permission !== 'granted') return 'denied';
  const reg = await registration();
  if (!reg) {
    report('no service worker registration');
    return 'error';
  }
  const key = await vapidKey();
  if (!key) return 'error';
  try {
    const sub = await ensureSubscription(reg, key);
    return (await saveOnServer(sub, lang)) ? 'ok' : 'error';
  } catch (e) {
    report(`subscribe failed: ${String(e).slice(0, 160)}`);
    return 'error';
  }
}

/**
 * On app open: a device whose listener already said yes re-sends its
 * subscription — at once when the server never confirmed it, otherwise at most
 * once a day. Never asks for permission; never throws.
 */
export async function syncPush(now = Date.now()): Promise<'skipped' | 'ok' | 'error'> {
  try {
    if (!pushSupported() || Notification.permission !== 'granted') return 'skipped';
    const reg = await registration();
    if (!reg) return 'skipped';
    const current = await reg.pushManager.getSubscription().catch(() => null);
    const confirmed = readConfirmation();
    if (current && confirmed?.endpoint === current.endpoint && now - confirmed.at < PUSH_RESYNC_MS) return 'skipped';
    const key = await vapidKey();
    if (!key) return 'error';
    const sub = await ensureSubscription(reg, key);
    // Stamped with the caller's clock, so "once a day" is measured from the
    // sync that sent it, not from a few milliseconds later.
    return (await saveOnServer(sub, undefined, now)) ? 'ok' : 'error';
  } catch (e) {
    report(`sync failed: ${String(e).slice(0, 160)}`);
    return 'error';
  }
}

export async function disablePush(): Promise<void> {
  writeConfirmation(null);
  const reg = await registration();
  if (!reg) return;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  const { endpoint } = sub;
  try {
    await sub.unsubscribe();
  } catch {
    // still notify the server below
  }
  try {
    await fetch('/api/push/unsubscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint }),
    });
  } catch {
    // ignore network errors on cleanup
  }
}
