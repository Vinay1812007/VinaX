/**
 * 13.7.3 — Android push registration: one notification-permission dialog per
 * launch however many start-up paths ask, push registration that reads that
 * answer instead of losing a race, the VinaX channel, the device language on
 * upload, and re-registration on resume when the token never reached the server.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android', isPluginAvailable: () => false },
}));
vi.mock('@/services/analytics/telemetry', () => ({ reportError: vi.fn() }));

/** One Android permission shared by both plugins, like POST_NOTIFICATIONS. */
const os = { state: 'prompt' as 'prompt' | 'granted' | 'denied', dialogs: 0, answer: 'granted' as 'granted' | 'denied' };
async function osRequest(): Promise<'granted' | 'denied'> {
  os.dialogs += 1;
  await new Promise((r) => setTimeout(r, 5)); // the dialog is up for a moment
  os.state = os.answer;
  return os.state;
}

const listeners: Record<string, (e: unknown) => void> = {};
const push = {
  createChannel: vi.fn(async () => undefined),
  addListener: vi.fn(async (name: string, fn: (e: unknown) => void) => {
    listeners[name] = fn;
    return { remove: async () => undefined };
  }),
  checkPermissions: vi.fn(async () => ({ receive: os.state })),
  requestPermissions: vi.fn(async () => ({ receive: await osRequest() })),
  register: vi.fn(async () => {
    setTimeout(() => listeners.registration?.({ value: 'fcm-token-'.padEnd(40, 'x') }), 0);
  }),
};
vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: push }));
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    checkPermissions: async () => ({ display: os.state }),
    requestPermissions: async () => ({ display: await osRequest() }),
  },
}));

const flush = () => new Promise((r) => setTimeout(r, 20));

beforeEach(async () => {
  // Let the previous test's pending token callback land before its listeners go.
  await flush();
  vi.resetModules();
  vi.clearAllMocks();
  os.state = 'prompt';
  os.dialogs = 0;
  os.answer = 'granted';
  for (const k of Object.keys(listeners)) delete listeners[k];
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"ok":true}', { status: 200 })));
});

describe('withNotificationPermission', () => {
  it('shows one dialog when the playback notification, announcements and push all ask at start-up', async () => {
    const native = await import('@/services/native');
    const { registerNativePush } = await import('./nativePush');
    await Promise.all([
      native.ensureNotificationPermission(),
      native.ensureNotificationPermission(),
      registerNativePush(() => undefined),
    ]);
    await flush();
    expect(os.dialogs).toBe(1);
    // Push read the answer and registered, instead of losing the race.
    expect(push.register).toHaveBeenCalledTimes(1);
  });

  it('after a "no", automatic callers do not ask again this launch, but a tap does', async () => {
    os.answer = 'denied';
    const native = await import('@/services/native');
    expect(await native.ensureNotificationPermission()).toBe('denied');
    // Android allows a second dialog; an automatic caller must not use it up.
    os.state = 'prompt';
    expect(await native.ensureNotificationPermission()).toBe('denied');
    expect(os.dialogs).toBe(1);
    os.answer = 'granted';
    expect(await native.ensureNotificationPermission(true)).toBe('granted');
    expect(os.dialogs).toBe(2);
  });
});

describe('registerNativePush', () => {
  it('creates the VinaX channel and uploads the token with the device language', async () => {
    const { registerNativePush, PUSH_CHANNEL } = await import('./nativePush');
    await registerNativePush(() => undefined);
    await flush();
    expect(push.createChannel).toHaveBeenCalledWith(expect.objectContaining({ id: 'vinax_picks', importance: 4 }));
    expect(PUSH_CHANNEL.id).toBe('vinax_picks');
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/push\/fcm-register$/);
    expect(JSON.parse(String(init.body))).toMatchObject({ platform: 'android', lang: navigator.language });
  });

  it('opens only in-app links from a tapped notification', async () => {
    const navigate = vi.fn();
    const { registerNativePush } = await import('./nativePush');
    await registerNativePush(navigate);
    listeners.pushNotificationActionPerformed({ notification: { data: { link: '//evil.example/x' } } });
    listeners.pushNotificationActionPerformed({ notification: { data: { link: '/song/x-1' } } });
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/song/x-1');
  });
});

describe('refreshNativePush (resume)', () => {
  it('registers once Android Settings allowed notifications, without asking', async () => {
    os.answer = 'denied';
    const { registerNativePush, refreshNativePush } = await import('./nativePush');
    await registerNativePush(() => undefined);
    expect(push.register).not.toHaveBeenCalled();
    os.state = 'granted'; // the listener turned it on in Settings and came back
    await refreshNativePush();
    await flush();
    expect(push.register).toHaveBeenCalledTimes(1);
    expect(os.dialogs).toBe(1);
  });

  it('does nothing once the token is on the server', async () => {
    os.state = 'granted';
    const { registerNativePush, refreshNativePush } = await import('./nativePush');
    await registerNativePush(() => undefined);
    await flush();
    await refreshNativePush();
    expect(push.register).toHaveBeenCalledTimes(1);
  });
});
