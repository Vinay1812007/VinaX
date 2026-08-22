// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { bumpStreak, getStreak, getBestStreak } from './streak';

describe('listening streak', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('counts consecutive days, ignores same-day, and keeps a personal best', () => {
    vi.setSystemTime(new Date('2024-01-01T10:00:00'));
    expect(bumpStreak()).toBe(1);
    expect(bumpStreak()).toBe(1); // same day → no change
    vi.setSystemTime(new Date('2024-01-02T10:00:00'));
    expect(bumpStreak()).toBe(2);
    vi.setSystemTime(new Date('2024-01-03T10:00:00'));
    expect(bumpStreak()).toBe(3);
    expect(getStreak()).toBe(3);
    // a gap resets the current streak but the best is retained
    vi.setSystemTime(new Date('2024-01-10T10:00:00'));
    expect(bumpStreak()).toBe(1);
    expect(getBestStreak()).toBe(3);
  });
});
