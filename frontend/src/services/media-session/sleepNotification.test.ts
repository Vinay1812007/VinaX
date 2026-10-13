/** 13.0.2 — the notification's sleep line, for each of the three timers. */
import { describe, expect, it } from 'vitest';
import { sleepLine } from './sleepNotification';

describe('sleepLine', () => {
  const NOW = 1_000_000;
  it('is empty when no timer is set', () => {
    expect(sleepLine(null, false, 0, NOW)).toBe('');
  });
  it('names the end of this song (flag, and songsLeft of one)', () => {
    expect(sleepLine(null, true, 0, NOW)).toBe('Sleeps after this song');
    expect(sleepLine(null, false, 1, NOW)).toBe('Sleeps after this song');
  });
  it('counts songs', () => {
    expect(sleepLine(null, false, 3, NOW)).toBe('Sleeps after 3 songs');
  });
  it('counts a clock timer down in whole minutes, never below one', () => {
    expect(sleepLine(NOW + 14 * 60_000, false, 0, NOW)).toBe('Sleeps in 14 min');
    expect(sleepLine(NOW + 30_000, false, 0, NOW)).toBe('Sleeps in 1 min');
    expect(sleepLine(NOW - 5_000, false, 0, NOW)).toBe('Sleeps in 1 min');
  });
  it('lets the end-of-song flag outrank a clock also set', () => {
    expect(sleepLine(NOW + 60_000, true, 0, NOW)).toBe('Sleeps after this song');
  });
});
