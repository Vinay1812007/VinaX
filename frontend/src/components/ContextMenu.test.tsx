// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContextMenu } from './ContextMenu';

vi.mock('./ContextMenuPanel', () => ({ default: () => <div role="menu" aria-label="App actions" /> }));

const pointer = (fine: boolean) => {
  window.matchMedia = ((q: string) => ({ matches: fine && q.includes('pointer: fine'), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
};

/** Fire contextmenu on `el`; true when something blocked the browser's menu. */
const rightClick = (el: Element): boolean => {
  const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  act(() => { el.dispatchEvent(ev); });
  return ev.defaultPrevented;
};

function page() {
  render(<ContextMenu />);
  document.body.insertAdjacentHTML('beforeend', '<div data-deter-context data-song-id="s1"><span id="row">Song</span></div><p id="text">A lyric line</p><input id="field" />');
  return { row: document.getElementById('row')!, text: document.getElementById('text')!, field: document.getElementById('field')! };
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  window.getSelection()?.removeAllRanges();
});

describe('ContextMenu gestures', () => {
  it('on touch, swallows the browser menu only on hold surfaces', () => {
    pointer(false);
    const { row, text, field } = page();
    expect(rightClick(row)).toBe(true);
    expect(rightClick(text)).toBe(false);
    expect(rightClick(field)).toBe(false);
  });

  it('with a mouse, opens the app menu but leaves Copy for selected text', () => {
    pointer(true);
    const { row, text } = page();
    expect(rightClick(row)).toBe(true);
    expect(rightClick(text)).toBe(true); // nothing selected: the app menu
    const range = document.createRange();
    range.selectNodeContents(text);
    window.getSelection()!.addRange(range);
    expect(rightClick(text)).toBe(false);
  });
});
