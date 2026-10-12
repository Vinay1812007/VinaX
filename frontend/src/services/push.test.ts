// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const reportError = vi.fn();
vi.mock('@/services/analytics/telemetry', () => ({ reportError: (...a: unknown[]) => reportError(...a) }));

import { decodeKey, enablePush, isPushSubscribed, PUSH_CONFIRM_KEY, PUSH_RESYNC_MS, syncPush } from './push';

const KEY = 'BP9VcomCl9p9BtB-Y0OwDW-YENuEcK91XaG6UzCtMgiAgH2exsZ44BsUHndI-4hrQL9DZLoi1ghyTml3zhKCBCc';
const OTHER_KEY = 'BOtherKeyOtherKeyOtherKeyOtherKeyOtherKeyOtherKeyOtherKeyOtherKeyOtherKeyOtherKeyOtherKeyAA';

interface FakeSub {
  endpoint: string;
  options: { applicationServerKey: ArrayBuffer };
  unsubscribe: ReturnType<typeof vi.fn>;
  toJSON: () => { endpoint: string; keys: { p256dh: string; auth: string } };
}

function fakeSub(endpoint: string, key: string): FakeSub {
  return {
    endpoint,
    options: { applicationServerKey: decodeKey(key).buffer },
    unsubscribe: vi.fn(async () => {
      if (current?.endpoint === endpoint) current = null;
      return true;
    }),
    toJSON: () => ({ endpoint, keys: { p256dh: 'p', auth: 'a' } }),
  };
}

let current: FakeSub | null;
let subscribeCalls: number;
let saved: string[];
let subscribeStatus: number;

beforeEach(() => {
  localStorage.clear();
  reportError.mockReset();
  current = null;
  subscribeCalls = 0;
  saved = [];
  subscribeStatus = 200;
  const pushManager = {
    getSubscription: vi.fn(async () => current),
    subscribe: vi.fn(async (opts: { applicationServerKey: Uint8Array }) => {
      subscribeCalls += 1;
      if (current) throw new DOMException('A subscription with a different applicationServerKey already exists.', 'InvalidStateError');
      current = fakeSub(`https://fcm.googleapis.com/fcm/send/new-${subscribeCalls}`, KEY);
      current.options.applicationServerKey = opts.applicationServerKey.buffer as ArrayBuffer;
      return current;
    }),
  };
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { ready: Promise.resolve({ pushManager }) } });
  Object.defineProperty(window, 'PushManager', { configurable: true, value: function PushManager() {} });
  Object.defineProperty(window, 'Notification', { configurable: true, writable: true, value: { permission: 'granted', requestPermission: async () => 'granted' } });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/push/vapid') return new Response(JSON.stringify({ key: KEY }), { status: 200 });
    if (url === '/api/push/subscribe') {
      saved.push(JSON.parse(String(init?.body)).endpoint);
      return new Response(JSON.stringify(subscribeStatus === 200 ? { ok: true } : { ok: false }), { status: subscribeStatus });
    }
    return new Response('{}', { status: 404 });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('11.7.1 web push', () => {
  it('a browser subscription the server never confirmed is NOT "subscribed"', async () => {
    current = fakeSub('https://fcm.googleapis.com/fcm/send/old', KEY);
    expect(await isPushSubscribed()).toBe(false);
  });

  it('re-sends a granted device whose server row was never confirmed (e.g. after a reset)', async () => {
    current = fakeSub('https://fcm.googleapis.com/fcm/send/old', KEY);
    expect(await syncPush()).toBe('ok');
    expect(saved).toEqual(['https://fcm.googleapis.com/fcm/send/old']);
    expect(await isPushSubscribed()).toBe(true);
  });

  it('stays quiet inside a day once confirmed, and re-sends after it', async () => {
    current = fakeSub('https://fcm.googleapis.com/fcm/send/old', KEY);
    const t0 = Date.now();
    await syncPush(t0);
    expect(await syncPush(t0 + 1_000)).toBe('skipped');
    expect(saved).toHaveLength(1);
    expect(await syncPush(t0 + PUSH_RESYNC_MS + 1)).toBe('ok');
    expect(saved).toHaveLength(2);
  });

  it('never asks for permission on its own', async () => {
    (window.Notification as unknown as { permission: string }).permission = 'default';
    expect(await syncPush()).toBe('skipped');
    expect(saved).toEqual([]);
  });

  it('replaces a subscription made for an old server key instead of failing forever', async () => {
    const old = fakeSub('https://fcm.googleapis.com/fcm/send/stale', OTHER_KEY);
    current = old;
    expect(await enablePush()).toBe('ok');
    expect(old.unsubscribe).toHaveBeenCalled();
    expect(saved).toEqual(['https://fcm.googleapis.com/fcm/send/new-1']);
  });

  it('a server that did not save it is an error, reported, and not confirmed', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    subscribeStatus = 500;
    const result = enablePush();
    await vi.runAllTimersAsync();
    expect(await result).toBe('error');
    expect(localStorage.getItem(PUSH_CONFIRM_KEY)).toBeNull();
    await vi.runAllTimersAsync();
    expect(reportError).toHaveBeenCalledWith('push-web', expect.stringContaining('subscribe 500'));
  });
});
