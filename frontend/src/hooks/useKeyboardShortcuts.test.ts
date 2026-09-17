// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const player = {
  currentTime: 50,
  duration: 200,
  volume: 0.5,
  queue: [],
  index: 0,
  togglePlay: vi.fn(),
  seek: vi.fn(),
  setVolume: vi.fn(),
  next: vi.fn(),
  prev: vi.fn(),
  toggleMute: vi.fn(),
  toggleShuffle: vi.fn(),
  cycleRepeat: vi.fn(),
};
vi.mock('@/store/playerStore', () => ({ usePlayerStore: { getState: () => player } }));
vi.mock('@/store/libraryStore', () => ({ useLibraryStore: { getState: () => ({ toggleFavorite: vi.fn() }) } }));
vi.mock('@/services/native', () => ({ isNativePlatform: () => false }));

const { useKeyboardShortcuts, shortcutsExempt } = await import('./useKeyboardShortcuts');

function el(tag: string, attrs: Record<string, string> = {}, parent: HTMLElement = document.body): HTMLElement {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  parent.appendChild(node);
  return node;
}

/** Dispatch a bubbling keydown from `target`; true when the page may still act on it. */
function press(target: HTMLElement, key: string): boolean {
  return target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

describe('shortcutsExempt', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('leaves Space and arrows to focused controls', () => {
    for (const node of [el('button'), el('a', { href: '#' }), el('div', { role: 'slider' }), el('div', { role: 'switch' }), el('li', { role: 'option' })]) {
      expect(shortcutsExempt(node, ' ')).toBe(true);
      expect(shortcutsExempt(node, 'ArrowRight')).toBe(true);
      expect(shortcutsExempt(node, 'ArrowUp')).toBe(true);
    }
  });

  it('keeps letter shortcuts live on a focused button', () => {
    expect(shortcutsExempt(el('button'), 'n')).toBe(false);
  });

  it('exempts every key in fields, selects and open dialogs', () => {
    expect(shortcutsExempt(el('input'), 'n')).toBe(true);
    expect(shortcutsExempt(el('textarea'), 'm')).toBe(true);
    expect(shortcutsExempt(el('select'), 's')).toBe(true);
    const dialog = el('div', { role: 'dialog' });
    expect(shortcutsExempt(el('p', {}, dialog), ' ')).toBe(true);
    expect(shortcutsExempt(el('p', {}, dialog), 'n')).toBe(true);
  });

  it('does not exempt plain page content', () => {
    expect(shortcutsExempt(el('div'), ' ')).toBe(false);
    expect(shortcutsExempt(document.body, 'ArrowLeft')).toBe(false);
    expect(shortcutsExempt(null, ' ')).toBe(false);
  });
});

describe('useKeyboardShortcuts', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('Space on the page toggles playback and is consumed', () => {
    renderHook(() => useKeyboardShortcuts());
    expect(press(el('div'), ' ')).toBe(false); // preventDefault()ed
    expect(player.togglePlay).toHaveBeenCalledTimes(1);
  });

  it('Space on a focused button is left to the button', () => {
    renderHook(() => useKeyboardShortcuts());
    expect(press(el('button'), ' ')).toBe(true);
    expect(player.togglePlay).not.toHaveBeenCalled();
  });

  it('arrows on a slider do not seek or change the volume', () => {
    renderHook(() => useKeyboardShortcuts());
    const slider = el('div', { role: 'slider' });
    press(slider, 'ArrowRight');
    press(slider, 'ArrowUp');
    expect(player.seek).not.toHaveBeenCalled();
    expect(player.setVolume).not.toHaveBeenCalled();
  });

  it('nothing fires from inside an open dialog', () => {
    renderHook(() => useKeyboardShortcuts());
    const inside = el('span', {}, el('div', { role: 'dialog' }));
    press(inside, ' ');
    press(inside, 'n');
    expect(player.togglePlay).not.toHaveBeenCalled();
    expect(player.next).not.toHaveBeenCalled();
  });

  it('letter shortcuts still work with a button focused', () => {
    renderHook(() => useKeyboardShortcuts());
    press(el('button'), 'n');
    expect(player.next).toHaveBeenCalledWith(true);
  });
});
