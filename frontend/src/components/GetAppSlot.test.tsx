// @vitest-environment jsdom
/** 13.7.4 — the "Get the app" bar at the top of the site on a phone's browser. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const native = { value: false };
vi.mock('@/services/native', () => ({ isNativePlatform: () => native.value }));

import { appOfferFor, GetAppSlot, SNOOZE_KEY, SNOOZE_MS } from './GetAppSlot';

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPADOS = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';

const base = { native: false, standalone: false, maxTouchPoints: 0, path: '/' };

describe('appOfferFor', () => {
  it('offers the Android app in an Android browser', () => {
    expect(appOfferFor({ ...base, ua: ANDROID, maxTouchPoints: 5 })).toBe('android');
  });
  it('offers the Home Screen on iPhone and iPad (there is no iOS app to download)', () => {
    expect(appOfferFor({ ...base, ua: IPHONE, maxTouchPoints: 5 })).toBe('ios');
    expect(appOfferFor({ ...base, ua: IPADOS, maxTouchPoints: 5 })).toBe('ios');
  });
  it('offers nothing on desktop, a Mac, inside the app, once on the Home Screen, or on the download page', () => {
    expect(appOfferFor({ ...base, ua: DESKTOP })).toBeNull();
    expect(appOfferFor({ ...base, ua: IPADOS, maxTouchPoints: 0 })).toBeNull();
    expect(appOfferFor({ ...base, ua: ANDROID, native: true })).toBeNull();
    expect(appOfferFor({ ...base, ua: IPHONE, standalone: true })).toBeNull();
    expect(appOfferFor({ ...base, ua: ANDROID, path: '/download' })).toBeNull();
  });
});

function setUa(ua: string, touch = 5): void {
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
  Object.defineProperty(window.navigator, 'maxTouchPoints', { value: touch, configurable: true });
}

const renderAt = (path = '/') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <GetAppSlot />
    </MemoryRouter>,
  );

describe('<GetAppSlot />', () => {
  beforeEach(() => {
    localStorage.clear();
    native.value = false;
  });
  afterEach(() => cleanup());

  it('Android browser: a "Get the app" link to the download page at the top', async () => {
    setUa(ANDROID);
    renderAt('/');
    const link = await screen.findByRole('link', { name: 'Get the app' });
    expect(link.getAttribute('href')).toBe('/download');
    expect(screen.getByRole('region', { name: 'Get the VinaX app' })).toBeTruthy();
  });

  it('iPhone: shows how to add VinaX to the Home Screen instead of a download', async () => {
    setUa(IPHONE);
    renderAt('/');
    expect(screen.queryByRole('link', { name: 'Get the app' })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'How' }));
    expect(screen.getByText('Tap Share, then “Add to Home Screen”')).toBeTruthy();
  });

  it('"Not now" hides it for a week on this device', async () => {
    setUa(ANDROID);
    const t0 = Date.now();
    renderAt('/');
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('region', { name: 'Get the VinaX app' })).toBeNull();
    const until = Number(localStorage.getItem(SNOOZE_KEY));
    expect(until).toBeGreaterThanOrEqual(t0 + SNOOZE_MS);
    cleanup();
    renderAt('/');
    expect(screen.queryByRole('region', { name: 'Get the VinaX app' })).toBeNull();
  });

  it('comes back after the week', async () => {
    setUa(ANDROID);
    localStorage.setItem(SNOOZE_KEY, String(Date.now() - 1));
    renderAt('/');
    expect(await screen.findByRole('link', { name: 'Get the app' })).toBeTruthy();
  });

  it('is absent on desktop and inside the Android app', () => {
    setUa(DESKTOP, 0);
    const { container, unmount } = renderAt('/');
    expect(container.innerHTML).toBe('');
    unmount();
    setUa(ANDROID);
    native.value = true;
    expect(renderAt('/').container.innerHTML).toBe('');
  });
});
