// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FESTIVALS, type Festival } from '@/constants/festivals';
import { PARTICLE_CAP, festivalVisual } from '@/constants/festivalVisuals';
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

describe('<FestBackdrop /> set pieces (11.6)', () => {
  it('gives each festival the set piece its day is known for', () => {
    const cases: Array<[string, string, number]> = [
      ['diwali', '.fest-diya', 7],
      ['newyear', '.fest-fw', 5],
      ['holi', '.fest-bloom', 5],
      ['christmas', '.fest-twinkle', 16],
      ['eid', '.fest-lamp', 6],
    ];
    for (const [id, cls, pieces] of cases) {
      const { container, unmount } = render(<FestBackdrop festival={fest(id)} />);
      const set = container.querySelector('.fest-set');
      expect(set, `${id} has no set piece`).not.toBeNull();
      expect(set!.getAttribute('data-signature'), id).toBe(festivalVisual(id).signature);
      expect(set!.querySelectorAll(cls), `${id} pieces`).toHaveLength(pieces);
      unmount();
    }
  });

  it('lets the set piece take its share of the motion budget, not add to it', () => {
    // The owner's cap is on everything moving at once, so a festival with a
    // set piece draws fewer particles rather than more total pieces.
    const { container } = render(<FestBackdrop festival={fest('christmas')} />);
    const moving = container.querySelectorAll('.fest-p, .fest-twinkle').length;
    expect(moving).toBeLessThanOrEqual(PARTICLE_CAP.desktop);
    expect(container.querySelectorAll('.fest-twinkle').length).toBeGreaterThan(0);
  });

  it('spaces the lamps evenly along the bottom and hangs each lantern on its own cord', () => {
    const { container, unmount } = render(<FestBackdrop festival={fest('diwali')} />);
    const lefts = Array.from(container.querySelectorAll<HTMLElement>('.fest-diya'), (el) => parseFloat(el.style.left));
    expect(lefts).toEqual([...lefts].sort((a, b) => a - b));
    for (const l of lefts) { expect(l).toBeGreaterThan(0); expect(l).toBeLessThan(100); }
    unmount();

    const eid = render(<FestBackdrop festival={fest('eid')} />);
    const drops = Array.from(eid.container.querySelectorAll<HTMLElement>('.fest-lamp'), (el) => el.style.getPropertyValue('--fest-drop'));
    expect(drops.every((d) => /^[\d.]+vh$/.test(d))).toBe(true);
    // Every cord a different length — the first cut stepped by 5 against a
    // modulus of 15 and hung them in three tiers.
    expect(new Set(drops).size).toBe(drops.length);
  });

  it('gives every particle its own sway, so the fall never reads as rain', () => {
    const { container } = render(<FestBackdrop festival={fest('ugadi')} />);
    const sways = Array.from(container.querySelectorAll<HTMLElement>('.fest-p'), (el) => el.style.getPropertyValue('--fest-sway'));
    expect(sways.length).toBeGreaterThan(2);
    expect(sways.every((v) => /^\d+px$/.test(v))).toBe(true);
    // Nearly all of them distinct, not two values taking turns: the first cut
    // stepped by 13 against a modulus of 26 and produced exactly two widths,
    // which on screen is two columns of particles falling in lockstep.
    expect(new Set(sways).size).toBeGreaterThanOrEqual(sways.length - 1);
  });

  it('the two national days keep the flag and take no second set piece', () => {
    for (const id of ['independence', 'republic']) {
      const { container, unmount } = render(<FestBackdrop festival={fest(id)} />);
      expect(container.querySelector('.fest-flag'), id).not.toBeNull();
      expect(container.querySelector('.fest-set'), id).toBeNull();
      unmount();
    }
  });

  it.each([['reduceMotion'], ['dataSaver']] as const)('draws no set piece under %s', (key) => {
    useSettingsStore.setState({ [key]: true });
    const { container } = render(<FestBackdrop festival={fest('diwali')} />);
    expect(container.querySelector('.fest-set')).toBeNull();
    expect(container.querySelector('.fest-p')).toBeNull();
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

  it('opens with the day in its colours: a crest, a halo and one burst', () => {
    now.value = { festival: fest('diwali'), theme: fest('diwali'), preview: true };
    mount();
    const crest = document.querySelector('.fest-card .fest-crest');
    expect(crest).not.toBeNull();
    // The emblem, the ring of light and the burst all sit in the crest, so
    // they stay centred on the emblem whatever size it is drawn at.
    expect(crest!.querySelector('.fest-emblem')).not.toBeNull();
    expect(crest!.querySelector('.fest-halo')).not.toBeNull();
    const burst = crest!.querySelector('.fest-burst');
    expect(burst).not.toBeNull();
    const pieces = Array.from(burst!.querySelectorAll<HTMLElement>('i'));
    expect(pieces.length).toBeGreaterThan(8);
    // Each piece is thrown at its own angle, its own distance, its own spin.
    expect(new Set(pieces.map((el) => el.style.getPropertyValue('--fest-a'))).size).toBe(pieces.length);
    expect(new Set(pieces.map((el) => el.style.getPropertyValue('--fest-d'))).size).toBeGreaterThan(1);
    expect(pieces.every((el) => /^-?\d+deg$/.test(el.style.getPropertyValue('--fest-s')))).toBe(true);
  });

  it.each([['reduceMotion'], ['dataSaver']] as const)('under %s the greeting still opens, without the halo or the burst', (key) => {
    useSettingsStore.setState({ [key]: true });
    now.value = { festival: fest('diwali'), theme: fest('diwali'), preview: true };
    mount();
    expect(card()).not.toBeNull();
    expect(document.querySelector('.fest-card .fest-emblem')).not.toBeNull();
    expect(document.querySelector('.fest-halo')).toBeNull();
    expect(document.querySelector('.fest-burst')).toBeNull();
  });

  it('a preview from Settings opens immediately, even over another dialog', () => {
    now.value = { festival: fest('diwali'), theme: fest('diwali'), preview: true };
    otherDialog();
    mount();
    expect(card()).not.toBeNull();
  });
});
