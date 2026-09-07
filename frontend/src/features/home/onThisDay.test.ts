import { describe, expect, it } from 'vitest';
import { minutesToday, onThisDay } from './onThisDay';
import type { HistoryEntry, Song } from '@/types';

const song = (id: string, duration = 240): Song => ({
  kind: 'song', id, title: id, subtitle: 'A', artists: [], album: null, images: [], audio: [], duration,
  language: null, year: null, explicit: false, hasLyrics: false, playCount: null,
});
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).getTime();
const play = (id: string, ts: number, completed = true): HistoryEntry => ({ song: song(id), ts, completed });

describe('onThisDay (v5.12.0)', () => {
  const now = at(2026, 8, 7); // 7 Sep 2026

  it('returns null when history is empty or nothing matches the date', () => {
    expect(onThisDay([], now)).toBeNull();
    expect(onThisDay([play('x', at(2026, 7, 20))], now)).toBeNull();
  });

  it('finds the same day-of-month in earlier months, nearest anniversary first', () => {
    const entries = [
      play('lastmonth-1', at(2026, 7, 7)), play('lastmonth-2', at(2026, 7, 7, 9)),
      play('lastmonth-3', at(2026, 7, 8)), // ±1 day tolerance
      play('year-1', at(2025, 8, 7)), play('year-2', at(2025, 8, 7, 8)),
      play('today', at(2026, 8, 7, 8)), // never a memory
      play('yesterday', at(2026, 8, 6, 23)),
    ];
    const r = onThisDay(entries, now, 4);
    expect(r).not.toBeNull();
    expect(r!.label).toBe('Last month');
    expect(r!.songs.map((s) => s.id)).toEqual(['lastmonth-3', 'lastmonth-1', 'lastmonth-2', 'year-1', 'year-2']);
  });

  it('dedupes repeat plays and honours the minimum', () => {
    const entries = [play('a', at(2025, 8, 7)), play('a', at(2025, 8, 7, 9)), play('b', at(2025, 8, 7))];
    expect(onThisDay(entries, now, 4)).toBeNull();
    expect(onThisDay(entries, now, 2)!.songs.map((s) => s.id)).toEqual(['a', 'b']);
    expect(onThisDay(entries, now, 2)!.label).toBe('Last year');
  });
});

describe('minutesToday', () => {
  it('counts completed plays in full and skips at a third, today only', () => {
    const now = at(2026, 8, 7, 20);
    const entries = [
      play('a', at(2026, 8, 7, 10), true), // 4 min
      play('b', at(2026, 8, 7, 11), false), // 240/3 = 80s
      play('c', at(2026, 8, 6, 23), true), // yesterday
    ];
    expect(minutesToday(entries, now)).toBe(5); // 240 + 80 = 320s → 5.3 → 5
  });
});
