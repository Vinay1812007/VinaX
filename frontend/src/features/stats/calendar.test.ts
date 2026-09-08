import { describe, expect, it } from 'vitest';
import { calendarCells, listeningStreaks, localDayKey } from './calendar';
import type { HistoryEntry, Song } from '@/types';

const song = (id: string, duration = 240): Song => ({
  kind: 'song', id, title: id, subtitle: 'A', artists: [], album: null, images: [], audio: [], duration,
  language: null, year: null, explicit: false, hasLyrics: false, playCount: null,
});
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).getTime();
const play = (ts: number, completed = true, dur = 240): HistoryEntry => ({ song: song(`s${ts}`, dur), ts, completed });

describe('calendarCells (v5.17.0)', () => {
  const now = at(2026, 8, 9, 15); // Wednesday 9 Sep 2026

  it('builds a 12×7 Monday-first grid ending on the current week', () => {
    const r = calendarCells([], now);
    expect(r.cells).toHaveLength(84);
    expect(new Date(r.cells[0].ts).getDay()).toBe(1); // Monday
    expect(r.cells[0].key).toBe('2026-06-22');
    const todayIdx = r.cells.findIndex((c) => c.today);
    expect(todayIdx).toBe(84 - 7 + 2); // Wednesday of the last column
    expect(r.cells.slice(todayIdx + 1).every((c) => c.future)).toBe(true);
    expect(r.cells[todayIdx].future).toBe(false);
    expect(r.currentStreak).toBe(0);
    expect(r.longestStreak).toBe(0);
  });

  it('buckets minutes relative to the busiest day and counts streaks', () => {
    const entries = [
      play(at(2026, 8, 9, 10)), play(at(2026, 8, 9, 11)), play(at(2026, 8, 9, 12)), play(at(2026, 8, 9, 13)), // today 16 min
      play(at(2026, 8, 8)), // yesterday 4 min
      play(at(2026, 8, 7), false), // 80s → 1 min
      play(at(2026, 8, 1)), play(at(2026, 7, 31)), play(at(2026, 7, 30)), play(at(2026, 7, 29)), // 4-day run
      play(at(2026, 1, 1)), // outside the grid
    ];
    const r = calendarCells(entries, now);
    const byKey = new Map(r.cells.map((c) => [c.key, c]));
    expect(r.maxMinutes).toBe(16);
    expect(byKey.get('2026-09-09')?.level).toBe(4);
    expect(byKey.get('2026-09-08')?.level).toBe(1); // 4/16 = 0.25 → bucket 1
    expect(byKey.get('2026-09-07')?.minutes).toBe(1);
    expect(byKey.get('2026-09-06')?.level).toBe(0);
    expect(r.activeDays).toBe(7);
    expect(r.currentStreak).toBe(3);
    expect(r.longestStreak).toBe(4);
  });

  it('keeps a streak alive when today has no plays yet', () => {
    const days = new Set(['2026-09-08', '2026-09-07']);
    expect(listeningStreaks(days, now)).toEqual({ current: 2, longest: 2 });
    expect(listeningStreaks(new Set(['2026-09-06']), now).current).toBe(0);
  });

  it('localDayKey pads month and day', () => {
    expect(localDayKey(at(2026, 0, 5))).toBe('2026-01-05');
  });
});
