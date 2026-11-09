// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { HistoryEntry, Song } from '@/types';
import { KEYS } from '@/constants/storage-keys';
import { BADGES, BADGE_BY_ID } from './catalog';
import { advanceCounters, checkBadges, earnedIds, emptyLedger, evaluate, loadLedger, mergeLedgers, sanitizeLedger } from './engine';

const song = (id: string, artist: string, language = 'telugu'): Song =>
  ({ kind: 'song', id, title: id, subtitle: artist, artists: [{ id: artist, name: artist }], album: { id: 'a', name: 'A' }, images: [], audio: [], duration: 240, language, year: '2020', explicit: false, hasLyrics: false, playCount: 0 }) as unknown as Song;
const at = (y: number, mo: number, d: number, h: number, mi = 0): number => new Date(y, mo, d, h, mi).getTime();
const entry = (id: string, artist: string, ts: number, extra: Partial<HistoryEntry> & { language?: string } = {}): HistoryEntry =>
  ({ song: song(id, artist, extra.language), ts, completed: true, listenedSec: 240, ...extra });
const NOW = at(2026, 10, 9, 15);

describe('1.12 — badges', () => {
  beforeEach(() => localStorage.clear());

  it('the catalogue has unique ids, a target and a glyph each', () => {
    expect(new Set(BADGES.map((b) => b.id)).size).toBe(BADGES.length);
    for (const b of BADGES) expect(b.target).toBeGreaterThan(0);
    expect(BADGE_BY_ID.get('night-owl')?.glyph).toBe('🦉');
  });

  it('counts only plays newer than the last one seen, by hour, language and artist, and the best day', () => {
    const plays = [
      entry('a', 'Anirudh', at(2026, 10, 8, 1)),            // night
      entry('b', 'Anirudh', at(2026, 10, 8, 6), { language: 'tamil' }), // morning
      entry('c', 'Sid Sriram', at(2026, 10, 8, 13)),
      entry('d', 'DSP', at(2026, 10, 9, 14, 30), { language: 'hindi' }),
    ];
    const first = advanceCounters(emptyLedger(), plays, NOW);
    expect(first.counters).toMatchObject({ plays: 4, night: 1, morning: 1, lastTs: plays[3].ts, bestDayMin: 12 });
    expect(first.counters.languages.sort()).toEqual(['hindi', 'tamil', 'telugu']);
    expect(first.counters.artists).toEqual({ Anirudh: 2, 'Sid Sriram': 1, DSP: 1 });
    // The same history again adds nothing; one new play adds one.
    expect(advanceCounters(first, plays, NOW).counters.plays).toBe(4);
    const more = [entry('e', 'Anirudh', at(2026, 10, 9, 14, 50)), ...plays];
    const second = advanceCounters(first, more, NOW);
    expect(second.counters.plays).toBe(5);
    expect(second.counters.artists.Anirudh).toBe(3);
    // A play stamped in the future is ignored until its time comes.
    expect(advanceCounters(second, [entry('f', 'X', NOW + 3_600_000), ...more], NOW).counters.plays).toBe(5);
  });

  it('awards what is due, remembers the day, and never takes a badge back', () => {
    const plays = [entry('a', 'Anirudh', at(2026, 10, 9, 1))];
    const r = checkBadges({ entries: plays, streakDays: 7, favorites: 50, playlists: 0, goalWeeks: 0, now: NOW });
    expect(r.newlyEarned.map((b) => b.id).sort()).toEqual(['collector', 'first-note', 'streak-7']);
    expect(loadLedger().earned).toMatchObject({ 'first-note': '2026-11-09', 'streak-7': '2026-11-09', collector: '2026-11-09' });
    // History cleared, streak gone: the badges stay, nothing is announced twice.
    const again = checkBadges({ entries: [], streakDays: 0, favorites: 0, playlists: 0, goalWeeks: 0, now: NOW + 86_400_000 });
    expect(again.newlyEarned).toEqual([]);
    expect(earnedIds(again.ledger)).toEqual(['first-note', 'streak-7', 'collector']);
    const prog = again.progress;
    expect(prog[0].earnedAt).toBe('2026-11-09');
    expect(prog.filter((p) => p.earnedAt)).toHaveLength(3);
    const century = prog.find((p) => p.def.id === 'century')!;
    expect(century).toMatchObject({ earnedAt: null, value: 1, pct: 1 });
  });

  it('progress is the figure against the target, earned first then the nearest', () => {
    const ledger = emptyLedger();
    ledger.counters.plays = 350;
    ledger.counters.night = 10;
    ledger.earned.century = '2026-10-01';
    const rows = evaluate({ ledger, streakDays: 0, favorites: 0, playlists: 0, goalWeeks: 0 });
    expect(rows[0].def.id).toBe('century');
    expect(rows[1].def.id).toBe('first-note'); // 350 of 1: capped at 100 % but not yet marked earned (checkBadges does that)
    expect(rows.find((r) => r.def.id === 'marathoner')).toMatchObject({ value: 350, pct: 70 });
    expect(rows.find((r) => r.def.id === 'night-owl')).toMatchObject({ value: 10, pct: 40 });
  });

  it('merges by union: the earliest day wins, the counters take the larger side', () => {
    const a = emptyLedger();
    a.earned = { 'first-note': '2026-01-05', century: '2026-03-01' };
    a.counters = { ...a.counters, plays: 120, languages: ['telugu'], artists: { Anirudh: 50, DSP: 3 } };
    const b = emptyLedger();
    b.earned = { 'first-note': '2026-01-02', 'night-owl': '2026-02-01' };
    b.counters = { ...b.counters, plays: 80, night: 30, languages: ['tamil'], artists: { Anirudh: 20, Thaman: 9 } };
    const m = mergeLedgers(a, b);
    expect(m.earned).toEqual({ 'first-note': '2026-01-02', century: '2026-03-01', 'night-owl': '2026-02-01' });
    expect(m.counters).toMatchObject({ plays: 120, night: 30, artists: { Anirudh: 50, DSP: 3, Thaman: 9 } });
    expect(m.counters.languages.sort()).toEqual(['tamil', 'telugu']);
  });

  it('reads stored or imported data defensively', () => {
    expect(sanitizeLedger(null)).toEqual(emptyLedger());
    const s = sanitizeLedger({ earned: { 'first-note': '2026-01-01', 'Bad Id': '2026-01-01', century: 'yesterday' }, counters: { plays: -4, night: 'x', languages: ['Telugu', 'telugu', 7], artists: { A: 2, B: 'no' }, bestDayMin: 61.4 } });
    expect(s.earned).toEqual({ 'first-note': '2026-01-01' });
    expect(s.counters).toMatchObject({ plays: 0, night: 0, languages: ['telugu'], artists: { A: 2 }, bestDayMin: 61 });
    localStorage.setItem(KEYS.badges, '{"earned": 5}');
    expect(loadLedger()).toEqual(emptyLedger());
  });
});
