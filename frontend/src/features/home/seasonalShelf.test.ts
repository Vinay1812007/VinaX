/**
 * Which shelf Home offers, and the day marker the greeting strip carries.
 *
 * Every date here is explicit. `pickSeason` and `festivalDay` both read a date
 * and the calendar moves, so a test that reached for "now" would pass today
 * and fail on a date nobody chose — the shape that took out two suites in
 * 11.5.
 */
import { describe, expect, it } from 'vitest';
import { pickSeason } from './useSeasonalShelf';
import { FESTIVALS, activeFestival, festivalDay } from '@/constants/festivals';
import { festivalVisual } from '@/constants/festivalVisuals';

const at = (iso: string) => new Date(`${iso}T12:00:00Z`);
const fest = (id: string) => {
  const f = FESTIVALS.find((x) => x.id === id);
  if (!f) throw new Error(`no festival ${id}`);
  return f;
};

describe('pickSeason', () => {
  it('offers the festival that is actually on, not the month it falls in', () => {
    // Diwali sits in the Oct–Nov window that used to answer "Festival
    // Specials" with a generic query, while the whole rest of the app was
    // already saying Diwali.
    const diwali = fest('diwali');
    const season = pickSeason(at('2026-11-08'), 'IN', diwali);
    expect(season).toEqual({ id: 'fest-diwali', title: 'Diwali Songs', query: festivalVisual('diwali').query });
    expect(season!.query).not.toBe('festival celebration songs');
  });

  it('names the day the way the rest of the app does, dropping the long form', () => {
    expect(pickSeason(at('2026-01-14'), 'IN', fest('sankranti'))!.title).toBe('Sankranti Songs');
    expect(pickSeason(at('2026-11-08'), 'IN', fest('diwali'))!.title).toBe('Diwali Songs');
  });

  it('beats every month rule, including the ones that look more specific', () => {
    // December would otherwise answer Christmas, February Valentine's.
    expect(pickSeason(at('2026-12-25'), 'IN', fest('christmas'))!.id).toBe('fest-christmas');
    expect(pickSeason(at('2026-02-14'), 'US', fest('valentine'))!.id).toBe('fest-valentine');
  });

  it('falls back to the month when no festival is on', () => {
    expect(pickSeason(at('2026-12-03'), 'IN', null)).toEqual({ id: 'christmas', title: 'Christmas Songs', query: 'christmas holiday songs' });
    expect(pickSeason(at('2026-02-03'), 'US', null)!.id).toBe('valentine');
    expect(pickSeason(at('2026-10-20'), 'IN', null)!.id).toBe('festival');
    expect(pickSeason(at('2026-07-15'), 'IN', null)!.id).toBe('monsoon');
    expect(pickSeason(at('2026-07-15'), 'US', null)!.id).toBe('summer');
  });

  it('still returns nothing on a plain weekday afternoon', () => {
    // A Wednesday in January: no festival, no month rule, not the weekend.
    const d = at('2026-01-07');
    expect(d.getUTCDay()).toBe(3);
    expect(activeFestival(d)).toBeNull();
    expect(pickSeason(d, 'IN', null)).toBeNull();
  });
});

describe('festivalDay', () => {
  it('counts the days of a festival that runs for more than one', () => {
    const diwali = fest('diwali');
    const run = festivalDay(diwali, at('2026-11-08'));
    expect(run).not.toBeNull();
    expect(run!.days).toBeGreaterThan(1);
    expect(run!.day).toBeGreaterThanOrEqual(1);
    expect(run!.day).toBeLessThanOrEqual(run!.days);
  });

  it('walks 1, 2, 3 … across the window and never past its length', () => {
    const f = fest('diwali');
    const [mf, df, mt, dt] = f.windows[0];
    const days = Math.round((Date.UTC(2026, mt - 1, dt) - Date.UTC(2026, mf - 1, df)) / 86_400_000) + 1;
    const seen: number[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(2026, mf - 1, df + i, 12);
      seen.push(festivalDay(f, d)!.day);
    }
    expect(seen).toEqual(Array.from({ length: days }, (_, i) => i + 1));
  });

  it('says nothing for a single-day festival, or for a date outside the window', () => {
    expect(festivalDay(fest('gandhi'), at('2026-10-02'))).toBeNull();
    expect(festivalDay(fest('diwali'), at('2026-06-01'))).toBeNull();
  });
});
