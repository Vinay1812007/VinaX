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

  it('lifts a mood for a national day (5.14.0: every festival carries a music hint)', () => {
    // Republic Day (Jan 26) leans on energetic desh-bhakti tracks.
    expect(activeFestivalMusic(new Date(2026, 0, 26))).toEqual({ id: 'republic', languages: ['hindi'], moods: ['energetic'] });
  });
});
