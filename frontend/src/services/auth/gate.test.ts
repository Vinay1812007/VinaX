// @vitest-environment jsdom
/**
 * 13.9 — browse first, sign in to listen: the gate is inert until AuthGate
 * arms it for a signed-out visitor; armed, it opens the sign-in sheet with
 * the reason and keeps the action for after sign-in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KEYS } from '@/constants/storage-keys';
import { useUiStore } from '@/store/uiStore';
import { guestBrowseChosen, rememberGuestBrowse, requireAccount, setGuestBrowsing } from './gate';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  useUiStore.setState({ signIn: null });
});
afterEach(() => setGuestBrowsing(false));

describe('requireAccount', () => {
  it('lets everything through until a signed-out visitor is browsing', () => {
    expect(requireAccount('listen')).toBe(true);
    expect(useUiStore.getState().signIn).toBeNull();
  });

  it('armed and signed out: opens the sheet with the reason and the action to resume', () => {
    setGuestBrowsing(true);
    const resume = vi.fn();
    expect(requireAccount('save', resume)).toBe(false);
    expect(useUiStore.getState().signIn?.reason).toBe('save');
    useUiStore.getState().signIn?.resume?.();
    expect(resume).toHaveBeenCalledTimes(1);
    useUiStore.getState().closeSignIn();
    expect(useUiStore.getState().signIn).toBeNull();
  });

  it('armed but already signed in on this device: through', () => {
    setGuestBrowsing(true);
    localStorage.setItem(KEYS.account, JSON.stringify({ session: 'vx1.test', user: { name: 'T', email: 't@example.com', picture: null, username: 't' } }));
    expect(requireAccount('listen')).toBe(true);
    expect(useUiStore.getState().signIn).toBeNull();
  });
});

describe('guest browse flag', () => {
  it('remembers the choice for the tab', () => {
    expect(guestBrowseChosen()).toBe(false);
    rememberGuestBrowse();
    expect(guestBrowseChosen()).toBe(true);
  });
});
