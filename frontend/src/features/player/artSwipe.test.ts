import { describe, expect, it } from 'vitest';
import { beginArtSwipe, endArtSwipe, moveArtSwipe, swipeFollow, SWIPE_FOLLOW_MAX_PX } from './artSwipe';

describe('artSwipe', () => {
  it('stays undecided under the claim distance and never claims a vertical drag', () => {
    const s = beginArtSwipe(100, 300, 0);
    expect(moveArtSwipe(s, 110, 310)).toBeNull();
    expect(s.axis).toBeNull();
    // the finger goes down the page: the page scrolls, the artwork stays put
    expect(moveArtSwipe(s, 108, 340)).toBeNull();
    expect(s.axis).toBe('y');
    // even a later sideways drift no longer counts
    expect(moveArtSwipe(s, 20, 360)).toBeNull();
    expect(endArtSwipe(s, 20, 500)).toBeNull();
  });

  it('claims a horizontal drag and follows the finger with a damped, capped offset', () => {
    const s = beginArtSwipe(200, 300, 0);
    expect(moveArtSwipe(s, 170, 305)).toBe(swipeFollow(-30));
    expect(s.axis).toBe('x');
    expect(moveArtSwipe(s, 40, 320)).toBe(-SWIPE_FOLLOW_MAX_PX);
    expect(moveArtSwipe(s, 260, 320)).toBe(30);
  });

  it('left past the threshold is next, right is previous, short drags snap back', () => {
    const l = beginArtSwipe(200, 300, 0);
    moveArtSwipe(l, 160, 300);
    expect(endArtSwipe(l, 120, 600)).toBe('next');

    const r = beginArtSwipe(200, 300, 0);
    moveArtSwipe(r, 240, 300);
    expect(endArtSwipe(r, 290, 600)).toBe('prev');

    const short = beginArtSwipe(200, 300, 0);
    moveArtSwipe(short, 160, 300);
    expect(endArtSwipe(short, 150, 600)).toBeNull();
  });

  it('a fast short fling still changes the song', () => {
    const s = beginArtSwipe(200, 300, 0);
    moveArtSwipe(s, 170, 300);
    expect(endArtSwipe(s, 160, 150)).toBe('next');
    const slow = beginArtSwipe(200, 300, 0);
    moveArtSwipe(slow, 170, 300);
    expect(endArtSwipe(slow, 160, 900)).toBeNull();
  });
});
