// @vitest-environment jsdom
/**
 * "Allow access" — the start-up permission sheet: when it opens, what each
 * row shows, Allow / Allow all / Not now, and the welcome and Settings entry points.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const perms = { notifications: 'askable', microphone: 'askable' } as Record<'notifications' | 'microphone', string>;
const turnOnNotifications = vi.fn(async () => {
  perms.notifications = 'on';
  return 'ok' as const;
});
const nativeMicPermission = vi.fn(async () => true);

vi.mock('@/services/auth/google', () => ({
  currentAccount: () => ({ session: 'vx1.t.s', user: { name: 'Tester', email: 't@example.com', picture: null, username: null } }),
  onAccountChange: () => () => undefined,
}));
vi.mock('@/services/push/notifyAsk', () => ({
  notifyState: async () => perms.notifications,
  turnOnNotifications: () => turnOnNotifications(),
  snoozeAsk: vi.fn(),
}));
vi.mock('@/features/voice/stt', () => ({
  nativeMicState: async () => 'unsupported',
  nativeMicPermission: () => nativeMicPermission(),
}));

import { PermissionsSheet } from './PermissionsSheet';
import { openPermissionsSheet } from '@/services/permissions/open';
import { MIC_ANSWER_KEY, PERM_SNOOZE_KEY, permAskSnoozed } from '@/services/permissions/startup';
import { KEYS } from '@/constants/storage-keys';
import { useTutorialStore } from '@/store/tutorialStore';

const mount = () => render(<MemoryRouter><PermissionsSheet /></MemoryRouter>);
const dialog = () => screen.queryByRole('dialog', { name: 'Allow access' });

let micAnswer: 'granted' | 'denied' = 'granted';
const getUserMedia = vi.fn(async () => {
  if (micAnswer === 'denied') throw Object.assign(new Error('no'), { name: 'NotAllowedError' });
  perms.microphone = 'on';
  return { getTracks: () => [{ stop: vi.fn() }] };
});

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  localStorage.clear();
  localStorage.setItem(KEYS.onboarded, 'true');
  perms.notifications = 'askable';
  perms.microphone = 'askable';
  micAnswer = 'granted';
  vi.clearAllMocks();
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  Object.defineProperty(navigator, 'permissions', {
    configurable: true,
    value: { query: async () => ({ state: perms.microphone === 'on' ? 'granted' : perms.microphone === 'blocked' ? 'denied' : 'prompt' }) },
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const waitOpen = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_000);
  });
  return waitFor(() => expect(dialog()).not.toBeNull());
};

describe('PermissionsSheet', () => {
  it('opens at start-up with a row per unanswered permission and says why', async () => {
    mount();
    await waitOpen();
    expect(screen.getByText('Notifications')).toBeTruthy();
    expect(screen.getByText('Microphone')).toBeTruthy();
    expect(screen.getByText(/Search by voice/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Allow all' })).toBeTruthy();
  });

  it('stays closed when everything is answered, before the welcome, and while snoozed', async () => {
    perms.notifications = 'on';
    perms.microphone = 'on';
    const a = mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(dialog()).toBeNull();
    a.unmount();

    perms.notifications = 'askable';
    localStorage.removeItem(KEYS.onboarded);
    const b = mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(dialog()).toBeNull();
    b.unmount();

    localStorage.setItem(KEYS.onboarded, 'true');
    localStorage.setItem(PERM_SNOOZE_KEY, String(Date.now() + 60_000));
    mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(dialog()).toBeNull();
  });

  it('Allow all asks for notifications, then the mic, and closes when both are on', async () => {
    mount();
    await waitOpen();
    fireEvent.click(screen.getByRole('button', { name: 'Allow all' }));
    await waitFor(() => expect(dialog()).toBeNull());
    expect(turnOnNotifications).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(turnOnNotifications.mock.invocationCallOrder[0]).toBeLessThan(getUserMedia.mock.invocationCallOrder[0]);
  });

  it('a refused mic stays on screen with where to turn it on', async () => {
    micAnswer = 'denied';
    // A browser that cannot report the mic permission: our own ask's answer is remembered.
    Object.defineProperty(navigator, 'permissions', { configurable: true, value: undefined });
    mount();
    await waitOpen();
    fireEvent.click(screen.getByRole('button', { name: 'Allow microphone' }));
    await waitFor(() => expect(screen.getByText(/Blocked\. Allow it from the lock icon/)).toBeTruthy());
    expect(localStorage.getItem(MIC_ANSWER_KEY)).toBe('denied');
    expect(dialog()).not.toBeNull();
  });

  it('Not now hides it for three days', async () => {
    mount();
    await waitOpen();
    // The header's close button and the footer's both say "Not now".
    const notNow = screen.getAllByRole('button', { name: 'Not now' });
    fireEvent.click(notNow[notNow.length - 1]);
    await waitFor(() => expect(dialog()).toBeNull());
    expect(permAskSnoozed()).toBe(true);
    expect(permAskSnoozed(Date.now() + 3 * 86_400_000 + 1)).toBe(false);
  });

  it('opens at the end of the welcome even while snoozed', async () => {
    localStorage.setItem(PERM_SNOOZE_KEY, String(Date.now() + 60_000));
    mount();
    act(() => openPermissionsSheet('welcome'));
    await waitOpen();
  });

  it('waits for a guided tour to end before it opens', async () => {
    localStorage.setItem(PERM_SNOOZE_KEY, String(Date.now() + 60_000));
    useTutorialStore.getState().start('first-song');
    mount();
    act(() => openPermissionsSheet('welcome'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(dialog()).toBeNull();
    act(() => useTutorialStore.getState().stop());
    await waitOpen();
  });

  it('Settings shows the sheet with everything already allowed', async () => {
    perms.notifications = 'on';
    perms.microphone = 'on';
    mount();
    act(() => openPermissionsSheet('settings'));
    await waitFor(() => expect(dialog()).not.toBeNull());
    expect(screen.getAllByText('Allowed')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
  });
});
