// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/location/browserSignals', () => ({ readBrowserSignals: () => ({ country: 'IN', languages: [], timezone: 'Asia/Kolkata' }) }));

import { PLACE_ON_KEY, activeConnectors, connectorViews, placeConnectorOn } from '@/features/ai/connectors';
import { MEMORY_ENABLED_KEY, MEMORY_KEY, addMemory, loadMemories, memoryEnabled, setMemoryEnabled } from '@/features/ai/memory';
import { useSettingsStore } from '@/store/settingsStore';
import { ConnectorChips, ConnectorList, useConnectors } from './Connectors';

const EDGE = { country: 'IN', regionLabel: 'Telangana', city: 'Hyderabad', timezone: 'Asia/Kolkata', source: 'edge' as const };

/** The composer's wiring, without the composer: page-owned switches in state,
 *  the menu's list and the chip row side by side. */
function Harness(): ReactNode {
  const [think, setThink] = useState(false);
  const [nowPlaying, setNowPlaying] = useState(false);
  const c = useConnectors({
    think,
    nowPlaying,
    onThink: setThink,
    onNowPlaying: setNowPlaying,
  });
  return (
    <>
      <ConnectorList views={c.views} armed={c.armed} memoryCount={c.memoryCount} onToggle={c.toggle} />
      <ConnectorChips active={c.active} armed={c.armed} memoryCount={c.memoryCount} onToggle={c.toggle} />
    </>
  );
}

const sw = (name: string): HTMLElement => screen.getByRole('switch', { name });
const chips = (): string[] => {
  const g = screen.queryByRole('group', { name: 'Active connectors' });
  return g ? [...g.querySelectorAll('[data-connector]')].map((el) => el.getAttribute('data-connector') ?? '') : [];
};

beforeEach(() => {
  localStorage.clear();
  useSettingsStore.setState({ allowRegionInference: true, manualCountry: null, manualRegionLabel: null, inferredRegion: EDGE });
});
afterEach(cleanup);

describe('Connectors', () => {
  it('lists every context source the chat supports as a labelled switch', () => {
    render(<Harness />);
    const list = screen.getByRole('group', { name: 'Connectors' });
    const names = within(list)
      .getAllByRole('switch')
      .map((el) => el.getAttribute('aria-labelledby') && document.getElementById(el.getAttribute('aria-labelledby')!)?.textContent);
    expect(names).toEqual(['Think', 'Now playing', 'Memory', 'Place']);
    // Each one has a one-line description, and Place says what it would send.
    expect(document.getElementById(sw('Place').getAttribute('aria-describedby')!)?.textContent).toContain('Hyderabad, Telangana, IN');
    // Defaults: everything off except Place, which has always been sent.
    expect(within(list).getAllByRole('switch').map((el) => el.getAttribute('aria-checked'))).toEqual(['false', 'false', 'false', 'true']);
    expect(chips()).toEqual(['place']);
  });

  it('switches page connectors on and off, and shows the active ones as removable chips', () => {
    render(<Harness />);
    fireEvent.click(sw('Think'));
    fireEvent.click(sw('Now playing'));
    expect(sw('Think').getAttribute('aria-checked')).toBe('true');
    expect(chips()).toEqual(['think', 'nowPlaying', 'place']);
    fireEvent.click(screen.getByRole('button', { name: 'Turn off Think' }));
    expect(sw('Think').getAttribute('aria-checked')).toBe('false');
    expect(chips()).toEqual(['nowPlaying', 'place']);
  });

  it('Place is a chat-only switch that sticks, and is disabled when the region setting leaves nothing to send', () => {
    render(<Harness />);
    fireEvent.click(sw('Place'));
    expect(placeConnectorOn()).toBe(false);
    expect(localStorage.getItem(PLACE_ON_KEY)).toBe('0');
    expect(sw('Place').getAttribute('aria-checked')).toBe('false');
    cleanup();
    act(() => useSettingsStore.setState({ allowRegionInference: false }));
    render(<Harness />);
    expect(sw('Place').getAttribute('aria-disabled')).toBe('true');
    expect(document.getElementById(sw('Place').getAttribute('aria-describedby')!)?.textContent).toMatch(/region sharing is switched off/);
    fireEvent.click(sw('Place'));
    expect(sw('Place').getAttribute('aria-checked')).toBe('false');
  });

  it('Memory: on in one tap; off asks for a second tap before it forgets saved lines', () => {
    render(<Harness />);
    fireEvent.click(sw('Memory'));
    expect(memoryEnabled()).toBe(true);
    expect(sw('Memory').getAttribute('aria-checked')).toBe('true');
    act(() => {
      addMemory('I play the veena');
      addMemory('Keep it short');
    });
    const desc = (): string => document.getElementById(sw('Memory').getAttribute('aria-describedby')!)?.textContent ?? '';
    expect(desc()).toBe('2 saved lines ride with every chat');
    // First tap only arms it: nothing is forgotten yet.
    fireEvent.click(sw('Memory'));
    expect(memoryEnabled()).toBe(true);
    expect(loadMemories()).toHaveLength(2);
    expect(desc()).toBe('Tap again to forget all 2 saved lines');
    // Second tap forgets.
    fireEvent.click(sw('Memory'));
    expect(memoryEnabled()).toBe(false);
    expect(localStorage.getItem(MEMORY_KEY)).toBeNull();
    expect(sw('Memory').getAttribute('aria-checked')).toBe('false');
  });

  it('Memory chip: the × arms first, and the arming lapses after a few seconds', () => {
    vi.useFakeTimers();
    try {
      localStorage.setItem(MEMORY_ENABLED_KEY, '1');
      addMemory('One line');
      render(<Harness />);
      fireEvent.click(screen.getByRole('button', { name: 'Turn off Memory' }));
      expect(screen.getByRole('group', { name: 'Active connectors' }).textContent).toContain('Forget 1 line?');
      act(() => vi.advanceTimersByTime(6000));
      expect(screen.getByRole('button', { name: 'Turn off Memory' })).toBeTruthy();
      expect(memoryEnabled()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('follows a change made elsewhere (the settings dialog)', () => {
    render(<Harness />);
    act(() => setMemoryEnabled(true));
    expect(sw('Memory').getAttribute('aria-checked')).toBe('true');
    expect(chips()).toContain('memory');
  });
});

describe('connectorViews / activeConnectors', () => {
  const base = { think: false, nowPlaying: false, song: null, memoryOn: false, memoryCount: 0, placeOn: true, placeLabel: 'IN' };
  it('names the song that would be shared', () => {
    const v = connectorViews({ ...base, nowPlaying: true, song: 'Srivalli' }).find((x) => x.id === 'nowPlaying')!;
    expect(v.description).toBe('Share “Srivalli” with your message');
  });
  it('never lists a disabled connector as active', () => {
    const views = connectorViews({ ...base, placeLabel: null });
    expect(activeConnectors(views).map((v) => v.id)).toEqual([]);
  });
});
