// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { shouldRescueWheel } from './wheelRescue';

const mount = (html: string): HTMLElement => {
  const host = document.createElement('div');
  host.innerHTML = html;
  const el = host.firstElementChild as HTMLElement;
  document.body.appendChild(el);
  return el;
};
afterEach(() => { document.body.innerHTML = ''; });

describe('shouldRescueWheel', () => {
  it('never touches wheels inside the app', () => {
    const root = mount('<div id="root"><main><p id="x">page</p></main></div>');
    expect(shouldRescueWheel(root.querySelector('#x'), root, false)).toBe(false);
  });

  it('rescues a wheel that lands on an injected blocker under <body>', () => {
    const root = mount('<div id="root"></div>');
    const blocker = mount('<div style="position:fixed;inset:0"><span id="b"></span></div>');
    expect(shouldRescueWheel(blocker, root, false)).toBe(true);
    expect(shouldRescueWheel(blocker.querySelector('#b'), root, false)).toBe(true);
  });

  it('leaves VinaX’s own portalled overlays alone — the menu, its backdrop, sheets and their backdrops', () => {
    const root = mount('<div id="root"></div>');
    const menu = mount('<div data-vx-overlay><div id="backdrop"></div><div role="menu"><button id="item">Play next</button></div></div>');
    expect(shouldRescueWheel(menu.querySelector('#item'), root, false)).toBe(false);
    expect(shouldRescueWheel(menu.querySelector('#backdrop'), root, false)).toBe(false);
    // A backdrop that is an ANCESTOR of its dialog panel, with no marker of its own.
    const sheet = mount('<div id="sheet-backdrop"><div role="dialog"><p id="body">…</p></div></div>');
    expect(shouldRescueWheel(sheet, root, false)).toBe(false);
    expect(shouldRescueWheel(sheet.querySelector('#body'), root, false)).toBe(false);
  });

  it('does nothing when an overlay already handled the wheel, or before the app has mounted', () => {
    const root = mount('<div id="root"></div>');
    const blocker = mount('<div></div>');
    expect(shouldRescueWheel(blocker, root, true)).toBe(false);
    expect(shouldRescueWheel(blocker, null, false)).toBe(false);
    expect(shouldRescueWheel(null, root, false)).toBe(false);
  });
});
