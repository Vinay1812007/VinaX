import { describe, expect, it } from 'vitest';
import { greetingName } from './greetingName';

describe('greetingName', () => {
  it('pulls the owner out of a device-style name', () => {
    expect(greetingName("Vinays'S CG-IT-SA-NA-001 MacBook Air M1")).toBe('Vinay');
    expect(greetingName('Vinay’s iPhone')).toBe('Vinay');
    expect(greetingName('DESKTOP-7F3K2 Priya')).toBe('Priya');
  });
  it('uses the first name of a real name and keeps the listener’s own casing', () => {
    expect(greetingName('Sid Sriram')).toBe('Sid');
    expect(greetingName('McKenna Rose')).toBe('McKenna');
    expect(greetingName('  anirudh  ')).toBe('Anirudh');
    expect(greetingName('చంద్ర శేఖర్')).toBe('చంద్ర');
  });
  it('never returns a tag, and stays short', () => {
    expect(greetingName('CG-IT-SA-NA-001')).toBe('');
    expect(greetingName('')).toBe('');
    expect(greetingName(null)).toBe('');
    expect(greetingName('Bartholomewalexanderthegreat Smith').length).toBeLessThanOrEqual(18);
  });
});
