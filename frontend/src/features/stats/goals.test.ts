// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { HistoryEntry, Song } from '@/types';
import { loadLedger, markWeekMet, newArtistsThisWeek, previousWeekKey, weekGoals, weekStart, weekStreak } from './goals';
import { isoWeekKey } from '@/features/weekly/useWeeklyMix';

const song = (id: string, artist: string): Song =>
  ({ kind: 'song', id, title: id, subtitle: artist, artists: [{ id: artist, name: artist }], album: { id: 'a', name: 'A' }, images: [], audio: [], duration: 200, language: 'telugu', year: '2020', explicit: false, hasLyrics: false, playCount: 0 }) as unknown as Song;
const entry = (id: string, artist: string, ts: number, sec = 240): HistoryEntry => ({ song: song(id, artist), ts, completed: true, listenedSec: sec });

describe('15.0 — weekly goals', () => {
  beforeEach(() => localStorage.clear());
  const now = new Date(2026, 9, 21, 12); // Wed 21 Oct 2026
  const from = weekStart(now).getTime();

  it('starts the week on Monday and keys ISO weeks backwards', () => {
    expect(weekStart(now).getDay()).toBe(1);
    expect(previousWeekKey('2026-W43')).toBe('2026-W42');
    expect(previousWeekKey('2026-W01')).toBe('2025-W52');
    expect(previousWeekKey('2021-W01')).toBe('2020-W53');
  });

  it('counts only artists never heard before the week', () => {
    const entries = [entry('a', 'Sid Sriram', from - 86_400_000), entry('b', 'Sid Sriram', from + 1000), entry('c', 'Anirudh', from + 2000), entry('d', 'Anirudh', from + 3000), entry('e', 'Thaman', from + 4000)];
    expect(newArtistsThisWeek(entries, from).sort()).toEqual(['Anirudh', 'Thaman']);
  });

  it('builds both goals, records a met week and counts the streak', () => {
    const week = isoWeekKey(now);
    markWeekMet('minutes', previousWeekKey(week));
    markWeekMet('minutes', previousWeekKey(week, 2));
    const entries = [entry('a', 'X', from + 1000, 60 * 60), entry('b', 'Y', from + 2000, 60 * 60)];
    const goals = weekGoals(entries, { minutes: 60, artists: 5 }, now);
    expect(goals.map((g) => g.kind)).toEqual(['minutes', 'artists']);
    expect(goals[0]).toMatchObject({ value: 120, met: true, pct: 100, streak: 3, daysLeft: 5 });
    expect(goals[1]).toMatchObject({ value: 2, met: false, pct: 40, streak: 0 });
    expect(loadLedger().met.minutes).toContain(week);
    expect(weekStreak('artists', week, false)).toBe(0);
    expect(weekGoals(entries, { minutes: 0, artists: 0 }, now)).toEqual([]);
  });
});
