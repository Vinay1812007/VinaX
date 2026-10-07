// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/features/identity/handleClaim', () => ({
  USERNAME_RE: /^[a-z0-9_]{3,20}$/,
  pendingClaim: () => null,
  claimHandle: vi.fn(async (u: string) => {
    localStorage.setItem('vinax.test.claimed', u);
    return { status: 'confirmed' };
  }),
}));
vi.mock('@/services/api', () => ({ searchSongs: vi.fn(async () => []) }));
vi.mock('@/services/analytics/telemetry', () => ({ registerUser: vi.fn() }));
vi.mock('@/services/analytics/sessionInsights', () => ({ initSessionInsights: vi.fn() }));

import { OnboardingSheet } from './OnboardingSheet';
import { claimHandle } from '@/features/identity/handleClaim';
import { KEYS } from '@/constants/storage-keys';
import { getLocal } from '@/services/storage/local';
import { useSettingsStore } from '@/store/settingsStore';
import { useUiStore } from '@/store/uiStore';

const mount = () => render(<MemoryRouter><OnboardingSheet /></MemoryRouter>);
const press = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const heading = (name: string) => screen.findByRole('heading', { name });

beforeEach(() => {
  localStorage.clear();
  useSettingsStore.getState().setTemplate('aura');
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ available: true }) })));
});
afterEach(() => {
  cleanup();
  useUiStore.getState().closeTour();
  vi.unstubAllGlobals();
});

describe('OnboardingSheet (11.0 welcome)', () => {
  it('walks name → languages → look → slides, and the look step persists the app style', async () => {
    mount();
    const dialog = screen.getByRole('dialog');
    expect(dialog.querySelector('.vx-mat-thick')).toBeTruthy();
    await heading('Free. No sign-up.');
    expect(screen.getByText('Step 1 of 8')).toBeTruthy();

    // Required step: Escape does not close it, and an empty name is refused.
    fireEvent.keyDown(dialog, { key: 'Escape' });
    press('Continue');
    expect(screen.getByText('Enter a name of at least two letters.')).toBeTruthy();
    expect(getLocal<boolean>(KEYS.onboarded, false)).toBe(false);

    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Tester' } });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'tester_one' } });
    press('Continue');
    await heading('Choose your languages');
    // The third argument hands over the on-screen human check's token (11.1.0).
    expect(claimHandle).toHaveBeenCalledWith('tester_one', 'Tester', expect.any(Function));
    expect(getLocal<string>(KEYS.userName, '')).toBe('Tester');

    // Back, then Continue with the same username: it is not claimed twice.
    localStorage.setItem(KEYS.userHandle, JSON.stringify('tester_one'));
    press('Back');
    await heading('Free. No sign-up.');
    press('Continue');
    await heading('Choose your languages');
    expect(claimHandle).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('checkbox'));
    press('Continue');
    await heading('Pick your look');
    expect(getLocal<boolean>(KEYS.analyticsConsent, false)).toBe(true);
    expect(useSettingsStore.getState().pinnedLanguages.length).toBeGreaterThan(0);

    const styles = screen.getAllByRole('radio');
    expect(styles).toHaveLength(6);
    fireEvent.click(screen.getByRole('radio', { name: /Sangam/ }));
    expect(useSettingsStore.getState().template).toBe('sangam');
    expect(localStorage.getItem('vinax.settings.v1')).toContain('"template":"sangam"');
    expect(screen.getByRole('button', { name: 'Skip' })).toBeTruthy();
    press('Use this look');

    // The catalogue returned nothing, so the songs step is left out.
    await heading('Five places to go');
    await waitFor(() => expect(screen.getByText('Step 4 of 7')).toBeTruthy());
    press('Next');
    await heading('Tap one song');
    press('Next');
    press('Next');
    await heading('Yours to keep');
    expect(screen.getByRole('button', { name: 'Take a tour' })).toBeTruthy();
    press('Start listening');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(getLocal<boolean>(KEYS.onboarded, false)).toBe(true);
  });

  it('Escape closes an optional step, and a replay starts at the look', async () => {
    localStorage.setItem(KEYS.onboarded, JSON.stringify(true));
    localStorage.setItem(KEYS.userHandle, JSON.stringify('tester_one'));
    useUiStore.getState().openTour();
    mount();
    await heading('Pick your look');
    expect(screen.getByText('Step 1 of 5')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
