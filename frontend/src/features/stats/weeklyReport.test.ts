import { describe, expect, it } from 'vitest';
import { weeklyReport } from './weeklyReport';
import type { HistoryEntry, Song } from '@/types';

const song = (id: string, artist: string, language: string | null = 'telugu', duration = 240): Song => ({
  kind: 'song', id, title: id, subtitle: artist, artists: [{ id: artist, name: artist, role: 'primary' }] as Song['artists'],
  album: null, images: [], audio: [], duration, language, year: null, explicit: false, hasLyrics: false, playCount: null,
});
const DAY = 86_400_000;
const now = new Date(2026, 8, 7, 20).getTime();
const play = (s: Song, daysAgo: number, completed = true): HistoryEntry => ({ song: s, ts: now - daysAgo * DAY, completed });

describe('weeklyReport (v5.17.0)', () => {
  it('returns zeroed summaries for empty history', () => {
    const r = weeklyReport([], now);
    expect(r.thisWeek).toEqual({ minutes: 0, songs: 0, newArtists: 0, topArtist: null, topLanguage: null });
    expect(r.delta).toEqual({ minutes: 0, songs: 0, newArtists: 0 });
  });

  it('splits rolling 7-day windows and computes deltas', () => {
    const a = song('a', 'Anirudh');
    const b = song('b', 'Sid Sriram', 'tamil');
    const c = song('c', 'Ilaiyaraaja');
    const entries = [
      play(a, 0), play(a, 1), play(b, 2), // this week: 3 plays, 12 min
      play(c, 8), play(c, 9, false), // last week: 2 plays, 4 + 1.33 min
      play(a, 20), // long ago — Anirudh is not "new" this week
    ];
    const r = weeklyReport(entries, now);
    expect(r.thisWeek.songs).toBe(3);
    expect(r.thisWeek.minutes).toBe(12);
    expect(r.thisWeek.topArtist).toBe('Anirudh');
    expect(r.thisWeek.topLanguage).toBe('Telugu');
    expect(r.thisWeek.newArtists).toBe(1); // only Sid Sriram
    expect(r.lastWeek.songs).toBe(2);
    expect(r.lastWeek.minutes).toBe(5);
    expect(r.lastWeek.newArtists).toBe(1);
    expect(r.delta.songs).toBe(1);
    expect(r.delta.minutes).toBe(7);
  });

  it('ignores malformed entries', () => {
    const bad = [{ song: song('x', 'X'), ts: 'nope' } as unknown as HistoryEntry];
    expect(weeklyReport(bad, now).thisWeek.songs).toBe(0);
  });
});
