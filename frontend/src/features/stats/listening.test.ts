import { describe, expect, it } from 'vitest';
import type { HistoryEntry, Song } from '@/types';
import { coverageNote, creditedSeconds, formatHours, formatMinutes, historyCoverage, listeningTotal } from './listening';

const song = (duration: number | null): Song => ({ kind: 'song', id: 'x', title: 'x', subtitle: '', artists: [], album: null, images: [], audio: [], duration, language: null, year: null, explicit: false, hasLyrics: false, playCount: null });
const play = (o: Partial<HistoryEntry> & { duration?: number | null }): HistoryEntry => ({ song: song(o.duration === undefined ? 240 : o.duration), ts: o.ts ?? 1_000, completed: o.completed ?? false, ...(o.listenedSec !== undefined ? { listenedSec: o.listenedSec } : {}) });

describe('creditedSeconds', () => {
  it('uses the measured duration when the player recorded one', () => {
    expect(creditedSeconds(play({ listenedSec: 97, completed: false }))).toEqual({ seconds: 97, measured: true });
    // Replays legitimately exceed the track length; only absurd values are capped.
    expect(creditedSeconds(play({ listenedSec: 500 })).seconds).toBe(500);
    expect(creditedSeconds(play({ listenedSec: 99_999 })).seconds).toBe(6 * 3600);
  });
  it('estimates older plays: full when completed, a third (30 s floor) otherwise', () => {
    expect(creditedSeconds(play({ completed: true }))).toEqual({ seconds: 240, measured: false });
    expect(creditedSeconds(play({ completed: false })).seconds).toBe(80);
    expect(creditedSeconds(play({ completed: false, duration: 60 })).seconds).toBe(30);
    expect(creditedSeconds(play({ completed: true, duration: null })).seconds).toBe(180);
    expect(creditedSeconds(play({ completed: false, duration: null })).seconds).toBe(45);
  });
  it('never back-fills a measurement onto an old play', () => {
    expect(creditedSeconds(play({ completed: true })).measured).toBe(false);
  });
});

describe('listeningTotal', () => {
  const entries = [play({ ts: 10, completed: true }), play({ ts: 20, listenedSec: 120 }), play({ ts: 30, completed: false })];
  it('sums within a window and flags estimates', () => {
    const all = listeningTotal(entries);
    expect(all.seconds).toBe(240 + 120 + 80);
    expect(all.minutes).toBe(7);
    expect(all.plays).toBe(3);
    expect(all.measuredPlays).toBe(1);
    expect(all.estimated).toBe(true);
    expect(listeningTotal(entries, 15, 25)).toMatchObject({ seconds: 120, plays: 1, estimated: false });
  });
  it('formats with ≈ only for estimates', () => {
    expect(formatMinutes({ minutes: 7, estimated: true })).toBe('≈ 7 min');
    expect(formatMinutes({ minutes: 2, estimated: false })).toBe('2 min');
    expect(formatHours({ seconds: 3600 * 1.25, estimated: true })).toBe('≈ 1.3h');
    expect(formatHours({ seconds: 3600 * 12, estimated: false })).toBe('12h');
  });
});

describe('historyCoverage', () => {
  it('a history below the cap always covers the window', () => {
    const cov = historyCoverage([play({ ts: 5_000 })], 1_000);
    expect(cov).toEqual({ capped: false, oldestTs: 5_000, complete: true });
    expect(coverageNote(cov, 'this week')).toBeNull();
  });
  it('a capped history whose oldest play is inside the window is incomplete', () => {
    const now = Date.UTC(2026, 8, 16);
    const entries = Array.from({ length: 150 }, (_, i) => play({ ts: now - i * 3_600_000 })); // ~6 days
    const weekAgo = now - 7 * 86_400_000;
    const cov = historyCoverage(entries, weekAgo);
    expect(cov.capped).toBe(true);
    expect(cov.complete).toBe(false);
    expect(coverageNote(cov, 'this week')).toMatch(/last 150 plays, so this week only counts listening since/);
    // The same 150 plays DO cover a one-day window.
    expect(historyCoverage(entries, now - 86_400_000).complete).toBe(true);
  });
});
