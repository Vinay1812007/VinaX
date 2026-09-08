import { describe, it, expect } from 'vitest';
import { festivalLookahead, festivalShortName, ribbonGradient } from './festivalLookahead';
import { FESTIVAL_THEMES } from '@/constants/festivalThemes';

// Diwali's window is Nov 6–10 (month/day only, so the year is irrelevant).
const at = (m: number, d: number) => new Date(2026, m - 1, d, 12);

describe('festivalLookahead (v5.19.0)', () => {
  it('returns null when nothing is within three days', () => {
    expect(festivalLookahead(at(11, 2))).toBeNull();
  });

  it('returns null while a festival is active today', () => {
    expect(festivalLookahead(at(11, 6))).toBeNull();
    expect(festivalLookahead(at(11, 10))).toBeNull();
  });

  it('describes the festival one to three days out with the theme swatch', () => {
    const three = festivalLookahead(at(11, 3));
    expect(three).toMatchObject({ inDays: 3, shortName: 'Diwali', title: 'Diwali in 3 days', query: 'Diwali songs' });
    expect(three?.festival.id).toBe('diwali');
    expect(three?.accent).toBe(FESTIVAL_THEMES.diwali.accent);
    expect(three?.ribbon).toEqual(FESTIVAL_THEMES.diwali.ribbon);
    expect(three?.note).toBe('The app dresses up for it the day before');

    const one = festivalLookahead(at(11, 5));
    expect(one?.inDays).toBe(1);
    expect(one?.title).toBe('Diwali in 1 day');
    expect(one?.note).toBe('The app is dressed up for it from today');
  });

  it('swaps the note when festival skins are off', () => {
    expect(festivalLookahead(at(11, 4), false)?.note).toBe('Festival themes are off in Settings');
    expect(festivalLookahead(at(11, 5), false)?.note).toBe('Festival themes are off in Settings');
  });

  it('shortens compound names for the title and query', () => {
    expect(festivalShortName('Sankranti · Pongal · Lohri')).toBe('Sankranti');
    expect(festivalShortName('Diwali (Dhanteras → Bhai Dooj)')).toBe('Diwali');
    expect(festivalShortName("Teachers' Day")).toBe("Teachers' Day");
    expect(festivalLookahead(at(1, 11))?.title).toBe('Sankranti in 2 days');
  });

  it('builds a left-to-right gradient, doubling a single stop', () => {
    expect(ribbonGradient(['#111', '#222'])).toBe('linear-gradient(90deg, #111, #222)');
    expect(ribbonGradient(['#111'])).toBe('linear-gradient(90deg, #111, #111)');
  });
});
