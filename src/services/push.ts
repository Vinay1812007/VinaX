/**
 * Browser push-notification opt-in. Subscribes this device to Web Push and
 * registers the subscription with the backend (/api/push/*). Requires the
 * server VAPID_* env vars. No-ops gracefully where push is unsupported.
 */

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

function decodeKey(base64: string): BufferSource {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const normal = (base64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normal);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

async function vapidKey(): Promise<string | null> {
  try {
    const res = await fetch('/api/push/vapid');
    const data = (await res.json()) as { key?: string | null };
    return data.key ?? null;
  } catch {
    return null;
  }
}

export async function isPushSubscribed(): Promise<boolean> {
  const reg = await registration();
  if (!reg) return false;
  const sub = await reg.pushManager.getSubscription();
  return Boolean(sub);
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
  if (!reg) return 'error';
  const key = await vapidKey();
  if (!key) return 'error';
  try {
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeKey(key),
    });
    const data = sub.toJSON();
    const res = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // tzOffset (minutes east of UTC) powers the server's quiet-hours gate,
      // so nobody is pushed at 3am local. Coarse and non-identifying.
      body: JSON.stringify({ endpoint: data.endpoint, keys: data.keys, lang, tzOffset: -new Date().getTimezoneOffset() }),
    });
    const saved = (await res.json().catch(() => null)) as { ok?: boolean } | null;
    return saved?.ok ? 'ok' : 'error';
  } catch {
    return 'error';
  }
}

export async function disablePush(): Promise<void> {
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
