// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useSettingsStore } from '@/store/settingsStore';
import { useToastStore } from '@/store/toastStore';
import { SmartQueue, smartQueueExplanation, smartQueueOn } from './SmartQueue';

const mount = () => render(<MemoryRouter><SmartQueue /></MemoryRouter>);
const sw = () => screen.getByRole('switch', { name: 'Smart Queue' });

beforeEach(() => {
  useSettingsStore.setState({ autoplay: true, djTakeover: true, aiDj: true, aiAssist: true });
  useToastStore.setState({ toasts: [] });
});
afterEach(cleanup);

describe('Smart Queue', () => {
  it('is on only when Autoplay and "DJ builds every queue" are both on', () => {
    expect(smartQueueOn({ autoplay: true, djTakeover: true })).toBe(true);
    expect(smartQueueOn({ autoplay: false, djTakeover: true })).toBe(false);
    expect(smartQueueOn({ autoplay: true, djTakeover: false })).toBe(false);
  });

  it('explains what it does in each state', () => {
    expect(smartQueueExplanation({ autoplay: true, djTakeover: true, aiDj: true })).toMatch(/^The DJ builds what plays next/);
    expect(smartQueueExplanation({ autoplay: true, djTakeover: true, aiDj: false })).toMatch(/on-device recommendations/);
    expect(smartQueueExplanation({ autoplay: true, djTakeover: false, aiDj: true })).toMatch(/similar songs keep the music going/);
    expect(smartQueueExplanation({ autoplay: false, djTakeover: false, aiDj: true })).toMatch(/stop at the end/);
  });

  it('switching off turns the DJ takeover off and leaves Autoplay alone', () => {
    mount();
    expect(sw().getAttribute('aria-checked')).toBe('true');
    expect(sw().getAttribute('aria-describedby')).toBe('vx-smartq-desc');
    fireEvent.click(sw());
    expect(useSettingsStore.getState().djTakeover).toBe(false);
    expect(useSettingsStore.getState().autoplay).toBe(true);
    expect(sw().getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText(/Songs play in the order you chose/)).toBeTruthy();
  });

  it('switching on turns both existing settings on — no new setting', () => {
    useSettingsStore.setState({ autoplay: false, djTakeover: false });
    mount();
    expect(sw().getAttribute('aria-checked')).toBe('false');
    fireEvent.click(sw());
    expect(useSettingsStore.getState()).toMatchObject({ autoplay: true, djTakeover: true });
    expect(sw().getAttribute('aria-checked')).toBe('true');
    expect(useToastStore.getState().toasts.slice(-1)[0]?.message).toMatch(/Smart Queue is on/);
  });
});
