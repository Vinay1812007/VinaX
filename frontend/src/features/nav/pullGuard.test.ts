// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { canStartPull, gestureAxis } from './pullGuard';

/** jsdom has no layout: say how tall a box is and how much lives inside it. */
const size = (el: Element, client: number, scroll: number): void => {
  Object.defineProperty(el, 'clientHeight', { value: client, configurable: true });
  Object.defineProperty(el, 'scrollHeight', { value: scroll, configurable: true });
};

const page = (inner: string): HTMLElement => {
  document.body.innerHTML = `<div id="root"><main id="main">${inner}</main></div>`;
  const main = document.getElementById('main') as HTMLElement;
  size(main, 800, 4000);
  return main;
};

afterEach(() => { document.body.innerHTML = ''; });

describe('canStartPull', () => {
  it('owns a drag that starts on the page, at the top', () => {
    const main = page('<section><p id="t">Home</p></section>');
    expect(canStartPull(main.querySelector('#t'), main)).toBe(true);
  });

  it('never pulls once the page has scrolled', () => {
    const main = page('<p id="t">Home</p>');
    main.scrollTop = 120;
    expect(canStartPull(main.querySelector('#t'), main)).toBe(false);
  });

  it('leaves an inner scroller its own drag (a sheet body, a chat transcript)', () => {
    const main = page('<div id="list" style="overflow-y:auto"><p id="t">row</p></div>');
    const list = main.querySelector('#list') as HTMLElement;
    size(list, 300, 1200);
    expect(canStartPull(main.querySelector('#t'), main)).toBe(false);
    // …but a short list with nothing to scroll is not an obstacle.
    size(list, 300, 300);
    expect(canStartPull(main.querySelector('#t'), main)).toBe(true);
  });

  it('leaves our own overlays alone — portalled to <body>, or rendered in place', () => {
    const main = page('<div role="dialog"><p id="t">sheet</p></div>');
    expect(canStartPull(main.querySelector('#t'), main)).toBe(false);
    const portalled = document.createElement('div');
    portalled.setAttribute('data-vx-overlay', '');
    portalled.innerHTML = '<div role="menu"><button id="m">Play next</button></div>';
    document.body.appendChild(portalled);
    expect(canStartPull(portalled.querySelector('#m'), main)).toBe(false);
  });

  it('ignores a touch that never reached the page (an injected blocker, no scroller yet)', () => {
    const main = page('<p>Home</p>');
    const blocker = document.createElement('div');
    document.body.appendChild(blocker);
    expect(canStartPull(blocker, main)).toBe(false);
    expect(canStartPull(main, null)).toBe(false);
    expect(canStartPull(null, main)).toBe(false);
  });
});

describe('gestureAxis', () => {
  it('waits for the gesture to commit', () => {
    expect(gestureAxis(2, 3)).toBe(null);
    expect(gestureAxis(-4, 5)).toBe(null);
  });

  it('calls it for the dominant direction', () => {
    expect(gestureAxis(2, 30)).toBe('y');
    expect(gestureAxis(-40, 6)).toBe('x');
    expect(gestureAxis(0, -20)).toBe('y');
  });
});
