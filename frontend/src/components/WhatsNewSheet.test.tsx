// @vitest-environment jsdom
/**
 * Locks two regressions:
 *
 *   1. v3.8.0 legacy-user fix: onboarded users whose lastSeenVersion was
 *      null saw no What's New sheet. The version-based comparison used a
 *      `last != null` short-circuit that hid every update from them.
 *
 *   2. v3.8.2 stale-LATEST_VERSION fix: nobody bumped LATEST_VERSION for
 *      a dozen shipped builds, so `last === LATEST_VERSION` was always true
 *      after the first show and no listener saw a What's New for any of
 *      those updates. The sheet now compares against a content fingerprint
 *      derived from the top CHANGELOG_V2 entry — updating the changelog
 *      alone flips the fingerprint and re-arms the sheet.
 */
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const CURRENT_FINGERPRINT = '3.8.0#deadbeef';

vi.mock('@/constants/version', () => ({ LATEST_VERSION: '3.8.0', DISPLAY_VERSION: 'VinaX V1' }));
/** Set by a test whose release card offers a guided tour. */
const card: { tour?: string } = {};
vi.mock('@/constants/changelog', () => ({
  latestNotes: () => ({
    title: 'A calmer, quieter VinaX',
    changes: [{ type: 'improved', text: 'Redesigned surfaces' }],
    ...card,
  }),
  latestNotesFingerprint: () => CURRENT_FINGERPRINT,
}));

import { WhatsNewSheet } from './WhatsNewSheet';
import { useTutorialStore } from '@/store/tutorialStore';

const KEY_LAST = 'vinax.last-seen-version';
const KEY_ONBOARDED = 'vinax.onboarded.v1';

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  delete card.tour;
  useTutorialStore.getState().stop();
});

describe('WhatsNewSheet — when it opens', () => {
  it('opens for an onboarded user whose lastSeenVersion is null (legacy adopter)', async () => {
    window.localStorage.setItem(KEY_ONBOARDED, 'true');
    // No lastSeenVersion at all — the pre-fix behaviour was to stay closed
    // forever. The regression the fix locks is: sheet DOES open now.
    render(<WhatsNewSheet />);
    expect(await screen.findByText(/What['’]s new/)).toBeTruthy();
  });

  it('opens for an onboarded user whose lastSeenVersion is an older release', async () => {
    window.localStorage.setItem(KEY_ONBOARDED, 'true');
    // Any pre-fingerprint legacy value ("3.7.0", raw version) doesn't match
    // the current fingerprint, so the sheet opens exactly once.
    window.localStorage.setItem(KEY_LAST, JSON.stringify('3.7.0'));
    render(<WhatsNewSheet />);
    expect(await screen.findByText(/What['’]s new/)).toBeTruthy();
  });

  it('opens for onboarded users whose stored value is a stale fingerprint (v3.8.2 regression)', async () => {
    window.localStorage.setItem(KEY_ONBOARDED, 'true');
    // Older fingerprint from a previous release — must trigger the sheet.
    window.localStorage.setItem(KEY_LAST, JSON.stringify('3.8.0#12345678'));
    render(<WhatsNewSheet />);
    expect(await screen.findByText(/What['’]s new/)).toBeTruthy();
  });

  it('stays closed when lastSeenVersion already matches the current fingerprint', async () => {
    window.localStorage.setItem(KEY_ONBOARDED, 'true');
    window.localStorage.setItem(KEY_LAST, JSON.stringify(CURRENT_FINGERPRINT));
    render(<WhatsNewSheet />);
    // The sheet portals into <body>, so the body — not the render container —
    // is what must stay empty. Assert stays empty across a microtask tick so the dynamic import
    // has a chance to resolve (it never should, since open is false).
    await waitFor(() => {
      expect(document.body.textContent ?? '').not.toMatch(/What['’]s new/);
    });
  });

  it('stays closed on a fresh install (onboarding not complete)', async () => {
    // No onboarded flag → the sheet must never race the onboarding modal
    // even though lastSeenVersion is null too.
    render(<WhatsNewSheet />);
    await waitFor(() => {
      expect(document.body.textContent ?? '').not.toMatch(/What['’]s new/);
    });
  });
});

describe('WhatsNewSheet — a card that offers a tour', () => {
  it('has no tour button on an ordinary card', async () => {
    window.localStorage.setItem(KEY_ONBOARDED, 'true');
    render(<WhatsNewSheet />);
    expect(await screen.findByText(/What['’]s new/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Take the tour' })).toBeNull();
  });

  it('“Take the tour” closes the sheet for good and starts that tour', async () => {
    card.tour = 'listen-together';
    window.localStorage.setItem(KEY_ONBOARDED, 'true');
    render(<WhatsNewSheet />);
    // “Let’s go” comes first, so the sheet's opening focus (and Enter) is still "close".
    const tourButton = await screen.findByRole('button', { name: 'Take the tour' });
    const go = screen.getByRole('button', { name: /Let.s go/ });
    expect(go.compareDocumentPosition(tourButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(tourButton);
    expect(useTutorialStore.getState().activeId).toBe('listen-together');
    expect(JSON.parse(window.localStorage.getItem(KEY_LAST) ?? 'null')).toBe(CURRENT_FINGERPRINT);
    await waitFor(() => expect(document.body.textContent ?? '').not.toMatch(/What['’]s new/));
  });
});
