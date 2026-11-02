import { describe, expect, it } from 'vitest';
import { announcementDue, compareVersions, dayPart, greetingLine, versionVerdict } from './appRules';

describe('greetingLine', () => {
  const at = (h: number) => new Date(2026, 10, 2, h, 0);
  it('picks the part of the day and adds the first name when asked', () => {
    const g = { text: 'Fresh picks', parts: { morning: 'Fresh picks', night: 'Sleep sounds' }, withName: true };
    expect(greetingLine(g, 'Asha Rao', at(8))).toBe('Hi Asha! Fresh picks');
    expect(greetingLine(g, 'Asha Rao', at(23))).toBe('Hi Asha! Sleep sounds');
    expect(greetingLine(g, 'Asha Rao', at(14))).toBe('');
    expect(greetingLine({ ...g, withName: false }, 'Asha', at(8))).toBe('Fresh picks');
  });
  it('shows an older single line all day', () => {
    expect(greetingLine({ text: 'Hello' }, null, at(14))).toBe('Hello');
    expect(greetingLine(null, 'A')).toBe('');
    expect(dayPart(5)).toBe('morning');
    expect(dayPart(4)).toBe('night');
  });
});

describe('versions', () => {
  it('compares numerically and ignores build suffixes', () => {
    expect(compareVersions('1.8.10', '1.8.9')).toBeGreaterThan(0);
    expect(compareVersions('1.8.3+183', '1.8.3')).toBe(0);
    expect(compareVersions('1.7', '1.7.1')).toBeLessThan(0);
  });
  it('says whether this install must update', () => {
    const p = { web: { minVersion: '1.8.0', mode: 'force' as const }, android: { minVersion: '1.8.0', mode: 'suggest' as const }, message: 'Update please' };
    expect(versionVerdict(p, 'web', '1.7.9')).toEqual({ outdated: true, force: true, minVersion: '1.8.0', message: 'Update please' });
    expect(versionVerdict(p, 'android', '1.7.9').force).toBe(false);
    expect(versionVerdict(p, 'web', '1.8.0').outdated).toBe(false);
    expect(versionVerdict(p, 'ios', '1.0.0').outdated).toBe(false);
  });
});

describe('announcementDue', () => {
  const a = { ts: 5, popup: true, show: 'once' as const, platforms: ['web'] };
  it('shows once per announcement, daily or every open as chosen, on chosen platforms', () => {
    expect(announcementDue(a, 'web', null, '2026-11-02', false)).toBe(true);
    expect(announcementDue(a, 'web', { ts: 5, day: '2026-11-01' }, '2026-11-02', false)).toBe(false);
    expect(announcementDue(a, 'android', null, '2026-11-02', false)).toBe(false);
    expect(announcementDue({ ...a, show: 'daily' }, 'web', { ts: 5, day: '2026-11-01' }, '2026-11-02', false)).toBe(true);
    expect(announcementDue({ ...a, show: 'daily' }, 'web', { ts: 5, day: '2026-11-02' }, '2026-11-02', false)).toBe(false);
    expect(announcementDue({ ...a, show: 'always' }, 'web', { ts: 5, day: '2026-11-02' }, '2026-11-02', false)).toBe(true);
    expect(announcementDue({ ...a, show: 'always' }, 'web', null, '2026-11-02', true)).toBe(false);
    expect(announcementDue({ ts: 5 }, 'web', null, '2026-11-02', false)).toBe(false);
  });
});
