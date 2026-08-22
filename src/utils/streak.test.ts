// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { bumpStreak, dayKey, getStreak, getBestStreak } from './streak';

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

  it('C6: day keys are UTC — immune to local timezone/DST jumps', () => {
    // 23:30Z and next-day 00:30Z are different UTC days no matter what the
    // machine's local zone claims; one hour apart never spans two days twice.
    expect(dayKey(Date.parse('2026-03-08T23:30:00Z'))).toBe('2026-03-08');
    expect(dayKey(Date.parse('2026-03-09T00:30:00Z'))).toBe('2026-03-09');
    vi.setSystemTime(new Date('2026-03-08T23:30:00Z'));
    expect(bumpStreak()).toBe(1);
    vi.setSystemTime(new Date('2026-03-09T00:30:00Z')); // one hour later
    expect(bumpStreak()).toBe(2); // a genuine new UTC day
  });
});
