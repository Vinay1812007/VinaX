import { describe, expect, it } from 'vitest';
import { countdownTo, currentOccurrence, festivalsByNextStart, nextStartOf, rangeLabel, shortName, upcomingFestivals } from './calendar';
import { FESTIVALS, festivalById } from '@/constants/festivals';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h);

describe('festival calendar', () => {
  it('knows today’s festival with its dates', () => {
    const o = currentOccurrence(at(2026, 11, 8))!;
    expect(o.festival.id).toBe('diwali');
    expect(o.start.getDate()).toBe(6);
    expect(o.end.getDate()).toBe(10);
    expect(o.end.getHours()).toBe(23);
    expect(currentOccurrence(at(2026, 11, 20))).toBeNull();
  });
  it('lists what comes next, each festival once, in order', () => {
    const list = upcomingFestivals(at(2026, 11, 8), 5);
    expect(list.map((o) => o.festival.id)).toEqual(['nagula', 'chhath', 'gurunanak', 'vaikunta', 'christmas']);
    expect(list[0]!.inDays).toBe(5);
    expect(list[0]!.start.getMonth()).toBe(10);
    // The running festival is not "upcoming".
    expect(list.some((o) => o.festival.id === 'diwali')).toBe(false);
  });
  it('wraps into next year and never repeats a festival', () => {
    const list = upcomingFestivals(at(2026, 12, 28), 40);
    const ids = list.map((o) => o.festival.id);
    expect(ids[0]).toBe('newyear');
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('sankranti');
  });
  it('finds the next start of one festival, this year or next', () => {
    expect(nextStartOf(festivalById('holi')!, at(2026, 11, 8))!.getFullYear()).toBe(2027);
    expect(nextStartOf(festivalById('christmas')!, at(2026, 11, 8))!.getDate()).toBe(24);
    expect(nextStartOf(festivalById('navratri')!, at(2026, 11, 8))).toBeNull();
    const sorted = festivalsByNextStart(at(2026, 11, 8));
    expect(sorted[0]!.festival.id).toBe('nagula');
    expect(sorted[sorted.length - 1]!.start).toBeNull();
    expect(sorted).toHaveLength(FESTIVALS.length);
  });
  it('counts down and labels ranges', () => {
    const c = countdownTo(at(2026, 11, 13, 0), new Date(2026, 10, 8, 20, 30, 15));
    expect(c).toMatchObject({ days: 4, hours: 3, minutes: 29, seconds: 45 });
    expect(countdownTo(at(2026, 1, 1), at(2026, 2, 1)).total).toBe(0);
    expect(rangeLabel(at(2026, 11, 6), at(2026, 11, 10))).toMatch(/6.*10/);
    expect(rangeLabel(at(2026, 12, 31), at(2027, 1, 1))).toMatch(/Dec.*Jan/);
    expect(shortName('Diwali (Dhanteras → Bhai Dooj)')).toBe('Diwali');
    expect(shortName('Sankranti · Pongal · Lohri')).toBe('Sankranti');
  });
});
