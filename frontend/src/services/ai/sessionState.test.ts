import { describe, expect, it } from 'vitest';
import { buildSessionContext, sessionDurationMinutes, sessionStateOf } from './sessionContext';

const MIN = 60_000;

describe('sessionStateOf', () => {
  it('reads behaviour before the clock', () => {
    expect(sessionStateOf({ hour: 14, day: 2, skips: 4, completionRate: 0.2, plays: 8, sittingMin: 10 })).toBe('RESTLESS');
    expect(sessionStateOf({ hour: 14, day: 2, skips: 2, completionRate: 0.6, plays: 8, sittingMin: 10 })).toBe('WAVERING');
    expect(sessionStateOf({ hour: 14, day: 2, skips: 0, completionRate: 1, plays: 6, sittingMin: 10 })).toBe('LOCKED_IN');
  });
  it('maps the clock to the named states', () => {
    expect(sessionStateOf({ hour: 23, day: 2, skips: 0, completionRate: 1, plays: 1, sittingMin: 5 })).toBe('LATE_NIGHT');
    expect(sessionStateOf({ hour: 23, day: 2, skips: 0, completionRate: 1, plays: 3, sittingMin: 60 })).toBe('WIND_DOWN');
    expect(sessionStateOf({ hour: 21, day: 6, skips: 0, completionRate: 1, plays: 0, sittingMin: 0 })).toBe('PARTY');
    expect(sessionStateOf({ hour: 7, day: 3, skips: 0, completionRate: 1, plays: 0, sittingMin: 0 })).toBe('MORNING');
    expect(sessionStateOf({ hour: 15, day: 3, skips: 0, completionRate: 0.8, plays: 2, sittingMin: 70 })).toBe('FOCUSED');
    expect(sessionStateOf({ hour: 18, day: 5, skips: 0, completionRate: 1, plays: 0, sittingMin: 0 })).toBe('ENERGETIC');
    expect(sessionStateOf({ hour: 15, day: 3, skips: 0, completionRate: 1, plays: 0, sittingMin: 0 })).toBe('CALM');
  });
});

describe('buildSessionContext counters', () => {
  it('derives skips, completion rate, sitting length and the last language/artist', () => {
    const now = Date.UTC(2026, 8, 16, 9, 0); // a Wednesday
    const song = (language: string, artist: string) => ({ language, artists: [{ name: artist }] });
    const history = [
      { ts: now - 2 * MIN, completed: false, song: song('telugu', 'Sid Sriram') },
      { ts: now - 10 * MIN, completed: true, song: song('telugu', 'Anirudh') },
      { ts: now - 25 * MIN, completed: true, song: song('hindi', 'Arijit') },
      { ts: now - 120 * MIN, completed: true, song: song('hindi', 'Arijit') }, // earlier sitting
    ];
    const ctx = buildSessionContext(history, new Date(now));
    expect(ctx.recentSkipCount).toBe(1);
    expect(ctx.recentCompletionRate).toBe(0.75);
    expect(ctx.sessionDurationMin).toBe(25);
    expect(ctx.recentLanguage).toBe('telugu');
    expect(ctx.recentArtist).toBe('Sid Sriram');
    expect(typeof ctx.sessionState).toBe('string');
    expect(sessionDurationMinutes([], now)).toBe(0);
    expect(sessionDurationMinutes([{ ts: now - 45 * MIN }], now)).toBe(0); // idle
  });
  it('a brand-new listener gets a sane context', () => {
    const ctx = buildSessionContext([], new Date(Date.UTC(2026, 8, 16, 9, 0)));
    expect(ctx.recentSkipCount).toBe(0);
    expect(ctx.recentCompletionRate).toBe(1);
    expect(ctx.recentLanguage).toBeUndefined();
  });
});
