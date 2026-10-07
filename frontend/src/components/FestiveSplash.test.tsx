// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FESTIVALS, type Festival } from '@/constants/festivals';
import { useSettingsStore } from '@/store/settingsStore';
import type { FestivalNow } from '@/features/festival/festivalPreview';

const now: { value: FestivalNow } = { value: { festival: null, theme: null, preview: false } };
vi.mock('@/features/festival/festivalPreview', () => ({ useFestivalNow: () => now.value }));

import { FestBackdrop, FestiveSplash, SETTLE_MS } from './FestiveSplash';

const fest = (id: string): Festival => {
  const f = FESTIVALS.find((x) => x.id === id);
  if (!f) throw new Error(`no festival ${id}`);
  return f;
};

beforeEach(() => {
  localStorage.clear();
  useSettingsStore.setState({ reduceMotion: false, dataSaver: false });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('<FestBackdrop /> on the national days', () => {
  it('Independence Day flies the flag: nine strips, a 24-spoke chakra and tricolour balls', () => {
    const { container } = render(<FestBackdrop festival={fest('independence')} />);
    const flag = container.querySelector('.fest-sky .fest-flag');
    expect(flag).not.toBeNull();
    expect(flag!.querySelectorAll(':scope > i')).toHaveLength(9);
    expect(flag!.querySelectorAll('.fest-chakra line')).toHaveLength(24);
    const balls = container.querySelectorAll('.fest-ball');
    expect(balls.length).toBeGreaterThanOrEqual(8);
    for (const c of ['fb0', 'fb1', 'fb2']) expect(container.querySelector(`.fest-ball.${c}`)).not.toBeNull();
    // The flag replaces the generic emblem watermark and the generic particles.
    expect(container.querySelector('.fest-wm')).toBeNull();
    expect(container.querySelector('.fest-p')).toBeNull();
    expect(container.querySelector('.fest-sky')!.getAttribute('aria-hidden')).not.toBeNull();
  });

  it('Republic Day flies the same flag without the balls', () => {
    const { container } = render(<FestBackdrop festival={fest('republic')} />);
    expect(container.querySelector('.fest-flag .fest-chakra')).not.toBeNull();
    expect(container.querySelector('.fest-ball')).toBeNull();
  });

  it('other festivals keep the emblem watermark and never get a flag', () => {
    const { container } = render(<FestBackdrop festival={fest('diwali')} />);
    expect(container.querySelector('.fest-flag')).toBeNull();
    expect(container.querySelector('.fest-wm')).not.toBeNull();
  });

  it.each([['reduceMotion'], ['dataSaver']] as const)('nothing moves under %s: no flag, no balls', (key) => {
    useSettingsStore.setState({ [key]: true });
    const { container } = render(<FestBackdrop festival={fest('independence')} />);
    expect(container.querySelector('.fest-flag')).toBeNull();
    expect(container.querySelector('.fest-ball')).toBeNull();
    expect(container.querySelector('.fest-wm')).not.toBeNull();
  });
});

describe('<FestiveSplash /> never stacks on another dialog', () => {
  const mount = () => render(<MemoryRouter><FestiveSplash /></MemoryRouter>);
  const otherDialog = () => {
    const el = document.createElement('div');
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    document.body.appendChild(el);
    return el;
  };
  const card = () => screen.queryByRole('dialog', { name: fest('diwali').greeting });

  it('waits a beat after boot, then opens when nothing else is up', () => {
    vi.useFakeTimers();
    now.value = { festival: fest('diwali'), theme: fest('diwali'), preview: false };
    mount();
    expect(card()).toBeNull();
    act(() => { vi.advanceTimersByTime(SETTLE_MS + 10); });
    expect(card()).not.toBeNull();
  });

  it('stays closed while another modal dialog is open and opens once it is gone', async () => {
    now.value = { festival: fest('diwali'), theme: fest('diwali'), preview: false };
    const sheet = otherDialog();
    mount();
    await act(async () => { await new Promise((r) => setTimeout(r, SETTLE_MS + 400)); });
    expect(card()).toBeNull();
    await act(async () => { sheet.remove(); await new Promise((r) => setTimeout(r, 250)); });
    expect(card()).not.toBeNull();
  });

  it('steps back if another dialog opens after it', async () => {
    now.value = { festival: fest('diwali'), theme: fest('diwali'), preview: false };
    mount();
    await act(async () => { await new Promise((r) => setTimeout(r, SETTLE_MS + 400)); });
    expect(card()).not.toBeNull();
    let sheet!: HTMLElement;
    await act(async () => { sheet = otherDialog(); await new Promise((r) => setTimeout(r, 250)); });
    expect(card()).toBeNull();
    await act(async () => { sheet.remove(); await new Promise((r) => setTimeout(r, 250)); });
    expect(card()).not.toBeNull();
  });

  it('a preview from Settings opens immediately, even over another dialog', () => {
    now.value = { festival: fest('diwali'), theme: fest('diwali'), preview: true };
    otherDialog();
    mount();
    expect(card()).not.toBeNull();
  });
});
