// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 12.2 — the welcome offers Google sign-in (optional); its script is never loaded in tests.
vi.mock('@/services/auth/google', () => ({
  // 13.0 — the welcome runs after sign-in.
  currentAccount: () => ({ session: 'vx1.t.s', user: { name: 'Tester', email: 't@example.com', picture: null, username: null } }),
  onAccountChange: () => () => undefined,
  renderGoogleButton: vi.fn(async () => true),
  signInNative: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock('@/services/api', () => ({ searchSongs: vi.fn(async () => []) }));
vi.mock('@/services/analytics/telemetry', () => ({ registerUser: vi.fn() }));
vi.mock('@/services/analytics/sessionInsights', () => ({ initSessionInsights: vi.fn() }));
// Finishing the welcome stamps the What's New fingerprint through a lazy
// import of the (large) changelog. Real, it can resolve after the test's
// environment is torn down — an unhandled EnvironmentTeardownError that turned
// CI red with every test passing. A stub resolves at once.
vi.mock('@/constants/changelog', () => ({ latestNotesFingerprint: () => 'test-fingerprint' }));

import { OnboardingSheet } from './OnboardingSheet';
import { KEYS } from '@/constants/storage-keys';
import { getLocal } from '@/services/storage/local';
import { useSettingsStore } from '@/store/settingsStore';
import { useUiStore } from '@/store/uiStore';

const mount = () => render(<MemoryRouter><OnboardingSheet /></MemoryRouter>);
const press = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const heading = (name: string) => screen.findByRole('heading', { name });

beforeEach(() => {
  localStorage.clear();
  useSettingsStore.getState().setTemplate('lumen');
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
    await heading('Welcome to VinaX');
    expect(screen.getByText('Step 1 of 8')).toBeTruthy();

    // Required step: Escape does not close it, and an empty name is refused.
    fireEvent.keyDown(dialog, { key: 'Escape' });
    // 13.0 — the name starts as the Google account's; cleared, it is refused.
    expect((screen.getByLabelText('Your name') as HTMLInputElement).value).toBe('Tester');
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: '' } });
    press('Continue');
    expect(screen.getByText('Enter a name of at least two letters.')).toBeTruthy();
    expect(getLocal<boolean>(KEYS.onboarded, false)).toBe(false);

    // 13.0 — sign-in happens before the welcome (AuthGate): the welcome asks only for a name.
    expect(screen.queryByLabelText('Username')).toBeNull();
    expect(screen.getByText(/You’re signed in\./)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Tester' } });
    press('Continue');
    await heading('Choose your languages');
    expect(getLocal<string>(KEYS.userName, '')).toBe('Tester');

    // Back and forward again keeps the name.
    press('Back');
    await heading('Welcome to VinaX');
    press('Continue');
    await heading('Choose your languages');

    // 14.0.3 — usage sharing starts ticked; unticking it is the choice that is stored.
    const box = screen.getByRole('checkbox') as HTMLInputElement;
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    expect(box.checked).toBe(false);
    press('Continue');
    await heading('Pick your look');
    expect(getLocal<boolean>(KEYS.analyticsConsent, true)).toBe(false);
    expect(useSettingsStore.getState().pinnedLanguages.length).toBeGreaterThan(0);

    const styles = screen.getAllByRole('radio');
    expect(styles).toHaveLength(6);
    fireEvent.click(screen.getByRole('radio', { name: /Monsoon/ }));
    expect(useSettingsStore.getState().template).toBe('monsoon');
    expect(localStorage.getItem('vinax.settings.v1')).toContain('"template":"monsoon"');
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
