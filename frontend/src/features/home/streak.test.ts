import { describe, expect, it } from 'vitest';
import { streakInfo } from './streak';
import type { HistoryEntry, Song } from '@/types';

const song = (id: string): Song => ({
  kind: 'song', id, title: id, subtitle: 'A', artists: [], album: null, images: [], audio: [], duration: 200,
  language: null, year: null, explicit: false, hasLyrics: false, playCount: null,
});
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).getTime();
const play = (ts: number, completed = true): HistoryEntry => ({ song: song(`s${ts}`), ts, completed });

describe('streakInfo (v5.17.0)', () => {
  const now = at(2026, 8, 9, 18);

  it('is zero with no qualifying days', () => {
    expect(streakInfo([], now)).toEqual({ days: 0, nextMilestone: 7, progress: 0, todayCounts: false });
    // One unfinished play does not count; three do.
    expect(streakInfo([play(at(2026, 8, 9), false)], now).days).toBe(0);
    expect(streakInfo([play(at(2026, 8, 9, 9), false), play(at(2026, 8, 9, 10), false), play(at(2026, 8, 9, 11), false)], now).days).toBe(1);
  });

  it('counts consecutive days and keeps yesterday-ending streaks alive', () => {
    const entries = [play(at(2026, 8, 8)), play(at(2026, 8, 7)), play(at(2026, 8, 6)), play(at(2026, 8, 3))];
    const r = streakInfo(entries, now);
    expect(r.days).toBe(3);
    expect(r.todayCounts).toBe(false);
    expect(r.nextMilestone).toBe(7);
    expect(r.progress).toBeCloseTo(3 / 7);
  });

  it('walks milestones 7 → 14 → 30 → 100 → 365', () => {
    const entries: HistoryEntry[] = [];
    for (let i = 0; i < 10; i++) entries.push(play(at(2026, 8, 9 - i)));
    const r = streakInfo(entries, now);
    expect(r.days).toBe(10);
    expect(r.todayCounts).toBe(true);
    expect(r.nextMilestone).toBe(14);
    expect(r.progress).toBeCloseTo(3 / 7);
  });
});
