import { describe, expect, it } from 'vitest';
import type { HistoryEntry, Song } from '@/types';
import { momentLine, momentOf, momentProfile, momentShelfTitle, partOfHour } from './moments';

const song = (id: string, artist: string, language = 'telugu'): Song => ({ id, title: id, subtitle: artist, artists: [{ id: artist, name: artist }], images: [], language, duration: 200 } as unknown as Song);
const play = (s: Song, at: Date, completed = true): HistoryEntry => ({ song: s, ts: at.getTime(), completed });
const at = (dayOffset: number, hour: number, base = new Date(2026, 10, 9, 12)): Date => new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayOffset, hour);

describe('listening moments', () => {
  it('names the part of the day and the kind of day', () => {
    expect(partOfHour(3)).toBe('late-night');
    expect(partOfHour(7)).toBe('early-morning');
    expect(partOfHour(10)).toBe('morning');
    expect(partOfHour(15)).toBe('afternoon');
    expect(partOfHour(19)).toBe('evening');
    expect(partOfHour(22)).toBe('night');
    // 2026-11-09 is a Monday; the 14th a Saturday; the 13th a Friday.
    expect(momentOf(new Date(2026, 10, 9, 19))).toMatchObject({ part: 'evening', weekend: false, label: 'weekday evening' });
    expect(momentOf(new Date(2026, 10, 14, 10))).toMatchObject({ weekend: true, label: 'weekend morning' });
    expect(momentOf(new Date(2026, 10, 13, 23)).weekend).toBe(true);
    expect(momentOf(new Date(2026, 10, 13, 15)).weekend).toBe(false);
    expect(momentShelfTitle(momentOf(new Date(2026, 10, 9, 19)))).toBe('For your weekday evenings');
  });

  it('reads the listener’s pattern for this moment only, newest three months', () => {
    const now = new Date(2026, 10, 9, 19, 30); // Monday evening
    const sid = song('a', 'Sid Sriram'), anirudh = song('b', 'Anirudh', 'tamil'), arijit = song('c', 'Arijit Singh', 'hindi');
    const history: HistoryEntry[] = [
      // Weekday evenings: Sid three times, Anirudh twice, one of them abandoned.
      play(sid, at(-3, 18)), play(sid, at(-4, 19)), play(sid, at(-7, 20)), play(anirudh, at(-5, 18)), play(anirudh, at(-6, 19), false),
      // A weekend evening (Sunday) and a weekday morning: other moments.
      play(arijit, at(-1, 19)), play(arijit, at(-3, 9)),
      // Too old to count.
      play(arijit, new Date(2026, 6, 1, 19)),
    ];
    const p = momentProfile(history, now);
    expect(p.label).toBe('weekday evening');
    expect(p.plays).toBe(5);
    expect(p.confidence).toBe(0.5);
    expect(p.languages).toEqual(['telugu', 'tamil']);
    expect(p.artists.map((a) => a.name)).toEqual(['Sid Sriram', 'Anirudh']);
    expect(p.artists[1]!.plays).toBe(1.5);
    expect(p.energy).not.toBeNull();
    expect(momentLine(p)).toBe('Weekday evenings you play Sid Sriram and Anirudh, mostly Telugu');
  });

  it('says nothing below four plays', () => {
    const now = new Date(2026, 10, 9, 19);
    const p = momentProfile([play(song('a', 'X'), at(-1, 19)), play(song('b', 'Y'), at(-2, 19))], now);
    expect(p.confidence).toBe(0);
    expect(momentLine(p)).toBeNull();
    expect(momentProfile([], now).plays).toBe(0);
  });
});
