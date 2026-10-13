// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = { native: false, nativePerm: 'prompt' as string, webSubscribed: false, pushSupported: true };
vi.mock('@/services/native', () => ({ isNativePlatform: () => state.native }));
vi.mock('@/services/push', () => ({
  pushSupported: () => state.pushSupported,
  isPushSubscribed: async () => state.webSubscribed,
  enablePush: vi.fn(async () => 'ok'),
}));
vi.mock('./nativePush', () => ({
  nativePushPermission: async () => state.nativePerm,
  enableNativePush: vi.fn(async () => 'ok'),
}));
const toast = vi.fn();
vi.mock('@/store/toastStore', () => ({ toast: (...a: unknown[]) => toast(...a) }));

import { emitPlaybackEvent } from '@/services/playback/session';
import type { Song } from '@/types';
import { ASK_SNOOZE_MS, askSnoozed, installNotifyAsk, notifyState, snoozeAsk, turnOnNotifications } from './notifyAsk';
import { enablePush } from '@/services/push';
import { enableNativePush } from './nativePush';

const song = { id: 's', title: 'S', artists: [] } as unknown as Song;
const play = () => emitPlaybackEvent({ kind: 'counted', instanceId: String(Math.random()), song, heardSec: 40 });
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  localStorage.clear();
  toast.mockReset();
  Object.assign(state, { native: false, nativePerm: 'prompt', webSubscribed: false, pushSupported: true });
  Object.defineProperty(window, 'Notification', { configurable: true, writable: true, value: { permission: 'default' } });
});

describe('11.7.2 notifyState', () => {
  it('web: undecided is askable, granted-but-unsaved is askable, saved is on, denied is blocked', async () => {
    expect(await notifyState()).toBe('askable');
    (window.Notification as unknown as { permission: string }).permission = 'granted';
    expect(await notifyState()).toBe('askable');
    state.webSubscribed = true;
    expect(await notifyState()).toBe('on');
    (window.Notification as unknown as { permission: string }).permission = 'denied';
    expect(await notifyState()).toBe('blocked');
  });

  it('the Android app is askable through native push (it used to have no ask at all)', async () => {
    state.native = true;
    state.pushSupported = false;
    expect(await notifyState()).toBe('askable');
    state.nativePerm = 'granted';
    expect(await notifyState()).toBe('on');
    state.nativePerm = 'denied';
    expect(await notifyState()).toBe('blocked');
  });

  it('turns on through the right path for each platform', async () => {
    await turnOnNotifications();
    expect(enablePush).toHaveBeenCalled();
    state.native = true;
    await turnOnNotifications();
    expect(enableNativePush).toHaveBeenCalled();
  });
});

describe('11.7.2 installNotifyAsk', () => {
  it('offers "Turn on" after the second song, once, and snoozes for a week', async () => {
    const off = installNotifyAsk();
    play();
    await flush();
    expect(toast).not.toHaveBeenCalled();
    play();
    await flush();
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][1].action.label).toBe('Turn on');
    play();
    await flush();
    expect(toast).toHaveBeenCalledTimes(1);
    expect(askSnoozed()).toBe(true);
    expect(askSnoozed(Date.now() + ASK_SNOOZE_MS + 1)).toBe(false);
    off();
  });

  it('stays quiet when snoozed, already on, or blocked', async () => {
    snoozeAsk();
    let off = installNotifyAsk();
    play();
    play();
    await flush();
    expect(toast).not.toHaveBeenCalled();
    off();
    localStorage.clear();
    (window.Notification as unknown as { permission: string }).permission = 'denied';
    off = installNotifyAsk();
    play();
    play();
    await flush();
    expect(toast).not.toHaveBeenCalled();
    off();
  });
});
