import { describe, it, expect } from 'vitest';
import { activeFestivalMusic } from './festival';

describe('activeFestivalMusic (A10)', () => {
  it('lifts Malayalam during the Onam window', () => {
    const m = activeFestivalMusic(new Date(2026, 7, 26)); // Aug 26
    expect(m?.id).toBe('onam');
    expect(m?.languages).toContain('malayalam');
  });

  it('lifts a devotional mood during Diwali', () => {
    const m = activeFestivalMusic(new Date(2026, 10, 8)); // Nov 8
    expect(m?.id).toBe('diwali');
    expect(m?.moods).toContain('devotional');
  });

  it('is null off-season', () => {
    expect(activeFestivalMusic(new Date(2026, 5, 15))).toBeNull(); // mid-June
  });

  it('is null for a visual-only festival with no music mapping', () => {
    // Republic Day (Jan 26) fires the splash but carries no music boost.
    expect(activeFestivalMusic(new Date(2026, 0, 26))).toBeNull();
  });
});
