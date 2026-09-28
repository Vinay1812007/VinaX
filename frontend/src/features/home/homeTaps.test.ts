// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { blockForTap } from './homeTaps';

const root = document.createElement('div');
root.innerHTML = `
  <header><a id="lang" href="#">Telugu</a></header>
  <span hidden data-home-block="quick"></span>
  <div><button id="tile">AI Radio</button></div>
  <span hidden data-home-block=""></span>
  <div class="more"><button id="chip">Charts</button></div>
  <span hidden data-home-block="discovery"></span>
  <section><a id="card" href="#"><img id="art" alt="" /></a><p id="text">not a control</p></section>
  <span hidden data-home-block=""></span>
`;
document.body.appendChild(root);
const el = (id: string) => root.querySelector(`#${id}`);

describe('blockForTap', () => {
  it('names the block a control sits in, from any element inside the control', () => {
    expect(blockForTap(root, el('tile'))).toBe('quick');
    expect(blockForTap(root, el('art'))).toBe('discovery');
    expect(blockForTap(root, el('card'))).toBe('discovery');
  });

  it('ignores taps outside blocks, on non-controls, and outside the root (menus in portals)', () => {
    expect(blockForTap(root, el('lang'))).toBeNull();
    expect(blockForTap(root, el('chip'))).toBeNull();
    expect(blockForTap(root, el('text'))).toBeNull();
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    expect(blockForTap(root, outside)).toBeNull();
    expect(blockForTap(root, null)).toBeNull();
  });
});
