/**
 * Which seasonal shelf Home offers.
 *
 * Every date here is explicit. `pickSeason` reads a date and the calendar
 * moves, so a test that reached for "now" would pass today and fail on a date
 * nobody chose — the shape that took out two suites in 11.5.
 */
import { describe, expect, it } from 'vitest';
import { pickSeason } from './useSeasonalShelf';

const at = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe('pickSeason', () => {
  it('picks the shelf from the month', () => {
    expect(pickSeason(at('2026-12-03'), 'IN')).toEqual({ id: 'christmas', title: 'Christmas Songs', query: 'christmas holiday songs' });
    expect(pickSeason(at('2026-02-03'), 'US')!.id).toBe('valentine');
    expect(pickSeason(at('2026-07-15'), 'IN')!.id).toBe('monsoon');
    expect(pickSeason(at('2026-07-15'), 'US')!.id).toBe('summer');
  });

  it('offers the weekend shelf on a Friday evening outside every month rule', () => {
    // A Friday in October, 18:00 UTC.
    const d = new Date('2026-10-23T18:00:00Z');
    expect(d.getUTCDay()).toBe(5);
    expect(pickSeason(d, 'IN')!.id).toBe('weekend');
  });

  it('returns nothing on a plain weekday afternoon', () => {
    // A Wednesday in January: no month rule, not the weekend.
    const d = at('2026-01-07');
    expect(d.getUTCDay()).toBe(3);
    expect(pickSeason(d, 'IN')).toBeNull();
    // October and November no longer have a shelf of their own.
    expect(pickSeason(at('2026-10-20'), 'IN')).toBeNull();
  });
});
