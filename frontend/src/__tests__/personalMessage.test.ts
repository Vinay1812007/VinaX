/**
 * Personalized home message — every listener gets their own line, derived
 * only from on-device signals. These tests pin the priority order and the
 * determinism guarantees.
 */
import { describe, expect, it } from 'vitest';
import { personalMessage, type MessageInput } from '../features/home/personalMessage';

function base(over: Partial<MessageInput> = {}): MessageInput {
  return {
    name: 'Sekhar',
    hour: 10,
    dayOfWeek: 2,
    dateKey: '2026-08-12',
    totalPlays: 40,
    weekPlays: 12,
    weekMinutes: 45,
    streakDays: 1,
    daysSinceLastListen: 0.5,
    topLanguage: 'telugu',
    topArtist: 'Sid Sriram',
    festivalId: null,
    ...over,
  };
}

describe('personalMessage priorities', () => {
  it('festival beats everything', () => {
    const m = personalMessage(base({ festivalId: 'diwali', streakDays: 9, totalPlays: 0 }));
    expect(m.title).toBe('Happy Diwali, Sekhar!');
  });

  it('a brand-new listener gets the honest welcome', () => {
    const m = personalMessage(base({ totalPlays: 0 }));
    expect(m.title).toBe('Welcome, Sekhar');
    expect(m.subtitle).toContain('learns your taste');
  });

  it('a 7-day gap gets the comeback, flavored by their language', () => {
    const m = personalMessage(base({ daysSinceLastListen: 9 }));
    expect(m.title).toBe('Welcome back, Sekhar');
    expect(m.subtitle).toContain('Telugu');
  });

  it('a 3+ day streak is celebrated', () => {
    const m = personalMessage(base({ streakDays: 5 }));
    expect(m.title).toContain('Day 5 streak');
  });

  it('friday evening gets its own energy; tuesday morning does not', () => {
    expect(personalMessage(base({ dayOfWeek: 5, hour: 20 })).title).toContain('Friday night');
    expect(personalMessage(base({ dayOfWeek: 2, hour: 10 })).title).toBe('Good morning, Sekhar');
  });

  it('late night goes calm', () => {
    const m = personalMessage(base({ hour: 1 }));
    expect(m.title).toContain('Late night waves');
    expect(m.subtitle).toContain('quiet hours');
  });
});

describe('determinism & personalization', () => {
  it('same listener, same day → same message; next day → may rotate', () => {
    const a = personalMessage(base());
    const b = personalMessage(base());
    expect(a).toEqual(b);
    // Across a 10-day window the rotation must actually change at least once.
    const days = Array.from({ length: 10 }, (_, d) => personalMessage(base({ dateKey: `2026-08-${10 + d}` })).subtitle);
    expect(new Set(days).size).toBeGreaterThan(1);
  });

  it('two different listeners can get different lines on the same day', () => {
    const names = ['Sekhar', 'Priya', 'Arjun', 'Meera', 'Ravi', 'Ananya', 'Kiran', 'Divya'];
    const lines = new Set(names.map((name) => personalMessage(base({ name })).subtitle));
    expect(lines.size).toBeGreaterThan(1);
  });

  it('never leaks a raw language id — always the display label', () => {
    const m = personalMessage(base({ daysSinceLastListen: 8, topLanguage: 'telugu' }));
    expect(m.subtitle).toContain('Telugu');
    expect(m.subtitle).not.toContain('telugu');
  });

  it('handles a nameless, profile-less cold device without awkward commas', () => {
    const m = personalMessage(base({ name: '', topLanguage: null, topArtist: null, totalPlays: 0 }));
    expect(m.title).toBe('Welcome');
    expect(m.title).not.toContain(',');
  });
});
