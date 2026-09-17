import { describe, expect, it } from 'vitest';
import { placeMenu } from './placeMenu';

describe('placeMenu', () => {
  it('opens upward from a docked composer and aligns right edges', () => {
    const p = placeMenu({ top: 730, bottom: 762, right: 1000 }, { width: 1280, height: 800 });
    expect(p).toEqual({ left: 648, width: 352, maxHeight: 480, bottom: 78 });
  });
  it('opens downward when there is room below, capped to the space there is', () => {
    const p = placeMenu({ top: 386, bottom: 418, right: 992 }, { width: 1280, height: 800 });
    expect(p.top).toBe(426);
    expect(p.bottom).toBeUndefined();
    expect(p.maxHeight).toBe(362);
  });
  it('never leaves a phone screen on either side', () => {
    const vp = { width: 390, height: 780 };
    const p = placeMenu({ top: 328, bottom: 360, right: 252 }, vp);
    expect(p.left).toBeGreaterThanOrEqual(12);
    expect(p.left + p.width).toBeLessThanOrEqual(vp.width - 12);
    const tiny = placeMenu({ top: 300, bottom: 332, right: 200 }, { width: 320, height: 568 });
    expect(tiny.left).toBe(12);
    expect(tiny.width).toBe(296);
  });
});
