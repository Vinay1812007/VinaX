import { describe, expect, it } from 'vitest';
import { HOOK_FRACTION, PREVIEW_SECONDS, chorusLine, hookPoint, previewEnd } from './hookPoint';

const lrc = (pairs: Array<[number, string]>) => pairs.map(([t, text]) => ({ t, text }));

describe('Flow hook point', () => {
  it('starts 30% in when there are no lyrics', () => {
    expect(hookPoint(200)).toBe(60);
    expect(hookPoint(200, null)).toBe(Math.round(200 * HOOK_FRACTION));
  });

  it('starts a beat before the first chorus-like line (a line sung again later)', () => {
    const lines = lrc([
      [12, 'Mellaga mellaga vachindi'],
      [24, 'Kalalo nuvve kanipinchavu'],
      [41, 'Nee navvule naa pranam'],
      [52, 'Oka maata cheppave'],
      [90, 'Nee navvule naa pranam'],
      [140, 'Nee navvule naa pranam'],
    ]);
    expect(chorusLine(lines, 240)?.t).toBe(41);
    expect(hookPoint(240, lines)).toBe(39.5);
  });

  it('prefers the chorus (sung most) over a verse that happens to come back once', () => {
    const lines = lrc([
      [24, 'Streetlights hum a slower tune'],
      [52, 'Stay a little longer here'],
      [80, 'Streetlights hum a slower tune'],
      [112, 'Stay a little longer here'],
      [140, 'Stay a little longer here'],
    ]);
    expect(chorusLine(lines, 200)?.t).toBe(52);
    expect(hookPoint(200, lines)).toBe(50.5);
  });

  it('matches a repeated line through punctuation and case', () => {
    const lines = lrc([
      [30, 'Hey, Jaana! Tu meri hai'],
      [60, 'something else entirely here'],
      [95, 'hey jaana tu meri hai'],
    ]);
    expect(chorusLine(lines, 220)?.t).toBe(30);
  });

  it('ignores repeats in the intro, short ad-libs and anything late in the song', () => {
    const lines = lrc([
      [2, 'Oh oh oh oh'], // intro, before 10% of the song
      [5, 'Oh oh oh oh'],
      [50, 'Hey'], // too short to be a chorus line
      [70, 'Hey'],
      [190, 'Last call for the night'], // after 75%
      [200, 'Last call for the night'],
    ]);
    expect(chorusLine(lines, 240)).toBeNull();
    expect(hookPoint(240, lines)).toBe(72);
  });

  it('always leaves a full preview window before the end', () => {
    const lines = lrc([
      [70, 'Sing it again and again'],
      [80, 'Sing it again and again'],
    ]);
    // 95 s song: the chorus at 70 s would leave less than 30 s.
    expect(hookPoint(95, lines)).toBe(95 - PREVIEW_SECONDS);
    expect(hookPoint(100)).toBe(30);
    expect(hookPoint(25)).toBe(0);
  });

  it('starts at the top when the length is unknown and nothing repeats', () => {
    expect(hookPoint(null)).toBe(0);
    expect(hookPoint(0, [])).toBe(0);
  });

  it('closes the window 30 s later, or at the song end', () => {
    expect(previewEnd(60, 200)).toBe(60 + PREVIEW_SECONDS);
    expect(previewEnd(10, 25)).toBe(25);
    expect(previewEnd(0, null)).toBe(PREVIEW_SECONDS);
  });
});
