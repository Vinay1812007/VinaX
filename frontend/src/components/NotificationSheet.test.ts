/**
 * 10.1.0 — the notifications inbox groups its rows under one heading per day,
 * newest first: Today, Yesterday, then the date; undated items last.
 */
import { describe, expect, it } from 'vitest';
import { dayLabel, groupByDay } from './NotificationSheet';

const NOW = new Date(2026, 9, 5, 15, 0).getTime();
const at = (daysAgo: number, hour = 10): number => new Date(2026, 9, 5 - daysAgo, hour, 0).getTime();

describe('notifications inbox grouping', () => {
  it('labels today, yesterday, older dates and undated items', () => {
    expect(dayLabel(at(0, 1), NOW)).toBe('Today');
    expect(dayLabel(at(1, 23), NOW)).toBe('Yesterday');
    expect(dayLabel(at(4), NOW)).not.toMatch(/Today|Yesterday|Earlier/);
    expect(dayLabel(undefined, NOW)).toBe('Earlier');
  });

  it('groups newest first, one heading per day', () => {
    const rows = [{ ts: at(1), id: 'y' }, { ts: at(0, 9), id: 't1' }, { id: 'u' }, { ts: at(0, 12), id: 't2' }, { ts: at(1, 8), id: 'y2' }];
    const groups = groupByDay(rows, NOW);
    expect(groups.map((g) => g.label)).toEqual(['Today', 'Yesterday', 'Earlier']);
    expect(groups[0].items.map((r) => r.id)).toEqual(['t2', 't1']);
    expect(groups[1].items.map((r) => r.id)).toEqual(['y', 'y2']);
    expect(groups[2].items.map((r) => r.id)).toEqual(['u']);
  });
});
