// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/location/browserSignals', () => ({ readBrowserSignals: () => ({ country: 'IN', languages: [], timezone: 'Asia/Kolkata' }) }));

import { CODE_ON_KEY, activeConnectors, codeChipNote, codeConnectorOn, connectorViews, type CodeSupport } from '@/features/ai/connectors';
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
    // 11.0 — no Place row: place follows the app-wide region setting alone.
    expect(names).toEqual(['Think', 'Now playing', 'Memory']);
    // Defaults: everything off.
    expect(within(list).getAllByRole('switch').map((el) => el.getAttribute('aria-checked'))).toEqual(['false', 'false', 'false']);
    expect(chips()).toEqual([]);
  });

  it('switches page connectors on and off, and shows the active ones as removable chips', () => {
    render(<Harness />);
    fireEvent.click(sw('Think'));
    fireEvent.click(sw('Now playing'));
    expect(sw('Think').getAttribute('aria-checked')).toBe('true');
    expect(chips()).toEqual(['think', 'nowPlaying']);
    fireEvent.click(screen.getByRole('button', { name: 'Turn off Think' }));
    expect(sw('Think').getAttribute('aria-checked')).toBe('false');
    expect(chips()).toEqual(['nowPlaying']);
  });

  it('11.0 — there is no Place row whatever the region setting says, and a stored 10.x placeOn value changes nothing', () => {
    localStorage.setItem('vinax.ai.placeOn', '0');
    render(<Harness />);
    expect(screen.queryByText('Place')).toBeNull();
    expect(chips()).toEqual([]);
    cleanup();
    act(() => useSettingsStore.setState({ allowRegionInference: false }));
    render(<Harness />);
    expect(screen.queryByText('Place')).toBeNull();
    expect(within(screen.getByRole('group', { name: 'Connectors' })).getAllByRole('switch')).toHaveLength(3);
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
  const base = { think: false, nowPlaying: false, song: null, memoryOn: false, memoryCount: 0 };
  it('names the song that would be shared', () => {
    const v = connectorViews({ ...base, nowPlaying: true, song: 'Srivalli' }).find((x) => x.id === 'nowPlaying')!;
    expect(v.description).toBe('Share “Srivalli” with your message');
  });
  it('lists nothing as active when nothing is on, and never a Place row', () => {
    const views = connectorViews(base);
    expect(activeConnectors(views).map((v) => v.id)).toEqual([]);
    expect(views.map((v) => v.id)).toEqual(['think', 'nowPlaying', 'memory']);
  });
});

describe('Run code (10.3)', () => {
  function CodeHarness({ available, support }: { available: boolean; support: CodeSupport }): ReactNode {
    const c = useConnectors({ think: false, nowPlaying: false, onThink: () => undefined, onNowPlaying: () => undefined, code: { available, support } });
    return (
      <>
        <ConnectorList views={c.views} armed={c.armed} memoryCount={c.memoryCount} onToggle={c.toggle} />
        <ConnectorChips active={c.active} armed={c.armed} memoryCount={c.memoryCount} onToggle={c.toggle} />
      </>
    );
  }

  it('is listed only when the server can run code (features.code)', () => {
    render(<CodeHarness available={false} support="auto" />);
    expect(screen.queryByRole('switch', { name: 'Run code' })).toBeNull();
    cleanup();
    render(<CodeHarness available support="auto" />);
    expect(sw('Run code').getAttribute('aria-checked')).toBe('false');
    expect(document.getElementById(sw('Run code').getAttribute('aria-describedby')!)?.textContent).toMatch(/Auto picks a model that can/);
  });

  it('switches on, sticks on the device, and shows a chip; off from the chip', () => {
    render(<CodeHarness available support="ok" />);
    fireEvent.click(sw('Run code'));
    expect(codeConnectorOn()).toBe(true);
    expect(localStorage.getItem(CODE_ON_KEY)).toBe('1');
    expect(chips()).toContain('code');
    // A model that can run code: no note on the chip.
    expect(document.querySelector('[data-connector="code"] .ai-conn-chip-note')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Turn off Run code' }));
    expect(codeConnectorOn()).toBe(false);
    expect(chips()).not.toContain('code');
  });

  it('says quietly when the pinned model cannot run code', () => {
    localStorage.setItem(CODE_ON_KEY, '1');
    render(<CodeHarness available support="unsupported" />);
    const chip = document.querySelector('[role="group"][aria-label="Active connectors"] [data-connector="code"]');
    expect(chip?.textContent).toContain('not available with this model');
    expect(document.getElementById(sw('Run code').getAttribute('aria-describedby')!)?.textContent).toMatch(/can’t run code/);
  });

  it('chip notes: only a pinned model that cannot run code gets one', () => {
    expect(codeChipNote('unsupported')).toBe('not available with this model');
    expect(codeChipNote('auto')).toBeNull();
    expect(codeChipNote('ok')).toBeNull();
    expect(codeChipNote('unknown')).toBeNull();
    const base = { think: false, nowPlaying: false, song: null, memoryOn: false, memoryCount: 0 };
    expect(connectorViews(base).map((v) => v.id)).not.toContain('code');
    expect(connectorViews({ ...base, codeAvailable: true, codeOn: true, codeSupport: 'ok' }).find((v) => v.id === 'code')).toMatchObject({ name: 'Run code', on: true, note: null });
  });
});
