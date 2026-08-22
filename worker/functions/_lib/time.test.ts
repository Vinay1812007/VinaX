/** Locks the IST prompt clock: the line every conversational engine reads
 *  must carry weekday, date and IST wall-clock time in the exact shape the
 *  prompts promise — UTC 14:12 is 7:42 pm IST (+5:30, no DST). */
import { describe, expect, it } from 'vitest';
import { istNowLine } from './time';

describe('istNowLine', () => {
  it('formats a known instant in IST', () => {
    // 2026-07-18T14:12:00Z == Saturday 18 July 2026, 7:42 pm IST
    expect(istNowLine(new Date('2026-07-18T14:12:00Z'))).toBe(
      'Current date & time: Saturday 18 July 2026, 7:42 pm IST.',
    );
  });

  it('crosses the date line correctly (late UTC evening is next-day IST)', () => {
    // 2026-12-31T20:00:00Z == Friday 1 January 2027, 1:30 am IST
    expect(istNowLine(new Date('2026-12-31T20:00:00Z'))).toBe(
      'Current date & time: Friday 1 January 2027, 1:30 am IST.',
    );
  });
});
