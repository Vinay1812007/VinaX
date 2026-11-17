import { describe, expect, it } from 'vitest';
import type { HistoryEntry, Song } from '@/types';
import type { StoredEvent } from '@/services/storage/idb';
import { HISTORY_CAP } from './listening';
import { inRange, logPlays, mergedCoverage, mergedCoverageNote, mergePlays, rangeStart, staleClearNote } from './playLog';

const MIN = 60_000;
const DAY = 86_400_000;
const NOW = new Date(2026, 10, 17, 12).getTime();

const song = (id: string, extra: Partial<Song> = {}): Song => ({
  kind: 'song', id, title: `T ${id}`, subtitle: 'A', artists: [{ id: 'a', name: 'A' }], album: null,
  images: [{ quality: '500x500', url: `https://img/${id}.jpg` }] as Song['images'], audio: [], duration: 200,
  language: 'telugu', year: null, explicit: false, hasLyrics: false, playCount: null, ...extra,
});
const hist = (id: string, ts: number, extra: Partial<HistoryEntry> = {}): HistoryEntry => ({ song: song(id), ts, completed: false, ...extra });
const ev = (type: string, songId: string, ts: number, extra: Partial<StoredEvent> = {}): StoredEvent => ({
  ts, type, songId, title: `Log ${songId}`, artistNames: ['Log Artist'], language: 'hindi', songDuration: 180, ...extra,
});

/** A full History: `n` plays, one a minute, newest at `newest`. */
const fullHistory = (newest: number, n = HISTORY_CAP): HistoryEntry[] =>
  Array.from({ length: n }, (_, i) => hist(`h${i}`, newest - i * MIN));

describe('logPlays', () => {
  it('keeps only play rows and reads completion and heard time from the row that ended them', () => {
    const plays = logPlays([
      ev('play', 'a', 1_000),
      ev('complete', 'a', 200_000, { playedSec: 190 }),
      ev('favorite', 'a', 210_000),
      ev('queue_add', 'b', 220_000),
      ev('play', 'b', 300_000),
      ev('skip', 'b', 310_000, { playedSec: 12 }),
      ev('play', 'c', 400_000),
    ]);
    expect(plays.map((p) => p.song.id)).toEqual(['a', 'b', 'c']);
    expect(plays[0]).toMatchObject({ completed: true, listenedSec: 190 });
    expect(plays[1]).toMatchObject({ completed: false, skipped: true, listenedSec: 12 });
    expect(plays[2].completed).toBe(false);
    expect(plays[2].listenedSec).toBeUndefined();
  });

  it('builds a song from the log row, or takes the stored one with its artwork', () => {
    const known = new Map([['a', song('a')]]);
    const [a, b] = logPlays([ev('play', 'a', 1), ev('play', 'b', 2)], known);
    expect(a.song.images).toHaveLength(1);
    expect(b.song).toMatchObject({ id: 'b', title: 'Log b', subtitle: 'Log Artist', language: 'hindi', duration: 180, images: [] });
    expect(b.song.artists[0].name).toBe('Log Artist');
  });
});

describe('mergePlays', () => {
  it('counts a play once when History and the log both hold it', () => {
    const history = [hist('x', NOW - 10 * MIN), hist('y', NOW - 20 * MIN)];
    // The log stamps a play once ~5 s are heard: a little after History's start time.
    const events = [ev('play', 'x', NOW - 10 * MIN + 6_000), ev('play', 'y', NOW - 20 * MIN + 90_000)];
    const m = mergePlays(history, events);
    expect(m.entries).toHaveLength(2);
    expect(m.fromLog).toBe(0);
    // History's entry wins: its artwork stays.
    expect(m.entries[0].song.images).toHaveLength(1);
  });

  it('pairs each log play with one History entry, so a replay is two plays', () => {
    const history = fullHistory(NOW).slice(0, 140);
    history.push(hist('r', NOW - 145 * MIN), hist('r', NOW - 150 * MIN));
    const events = [ev('play', 'r', NOW - 150 * MIN + 5_000), ev('play', 'r', NOW - 145 * MIN + 5_000)];
    const m = mergePlays(history, events);
    expect(m.entries.filter((e) => e.song.id === 'r')).toHaveLength(2);
    expect(m.fromLog).toBe(0);
  });

  it('fills in plays older than a full History from the log (other devices still count)', () => {
    // History came partly from another device ("other"), and is full.
    const history = fullHistory(NOW);
    history[3] = hist('other', NOW - 3 * MIN);
    const oldest = NOW - (HISTORY_CAP - 1) * MIN;
    const events = [
      ev('play', 'old1', oldest - 5 * DAY),
      ev('play', 'old2', oldest - 40 * DAY),
      ev('play', 'h0', NOW + 5_000), // the newest History play, logged on this device
    ];
    const m = mergePlays(history, events);
    expect(m.historyCapped).toBe(true);
    expect(m.fromLog).toBe(2);
    expect(m.entries).toHaveLength(HISTORY_CAP + 2);
    expect(m.entries.some((e) => e.song.id === 'other')).toBe(true);
    expect(m.entries[m.entries.length - 1].song.id).toBe('old2');
    // Newest first.
    expect(m.entries.every((e, i, a) => i === 0 || a[i - 1].ts >= e.ts)).toBe(true);
  });

  it('drops log plays the listener removed from History', () => {
    const history = fullHistory(NOW);
    // Inside History's stretch, unmatched: removed by hand.
    const removed = ev('play', 'gone', NOW - 30 * MIN);
    const m = mergePlays(history, [removed]);
    expect(m.fromLog).toBe(0);
  });

  it('ignores older log plays while History is short (it was cleared, not cut off)', () => {
    const history = [hist('x', NOW)];
    const m = mergePlays(history, [ev('play', 'old', NOW - 10 * DAY)]);
    expect(m.historyCapped).toBe(false);
    expect(m.entries).toHaveLength(1);
  });

  it('skips log plays inside a forgotten stretch', () => {
    const history = fullHistory(NOW);
    const oldest = NOW - (HISTORY_CAP - 1) * MIN;
    const events = [ev('play', 'a', oldest - 2 * DAY), ev('play', 'b', oldest - 3 * DAY), ev('play', 'c', oldest - 9 * DAY)];
    const m = mergePlays(history, events, {
      forgotten: [{ from: oldest - 2 * DAY - MIN, to: oldest - 2 * DAY + MIN, songId: 'a' }, { from: 0, to: oldest - 8 * DAY }],
    });
    expect(m.entries.filter((e) => ['a', 'b', 'c'].includes(e.song.id)).map((e) => e.song.id)).toEqual(['b']);
  });
});

describe('staleClearNote', () => {
  it('notes log plays older than a short History, so they stay hidden once it refills', () => {
    const history = [hist('x', NOW)];
    const events = [ev('play', 'old', NOW - 10 * DAY), ev('skip', 'old', NOW - 9 * DAY), ev('play', 'older', NOW - 20 * DAY), ev('play', 'x', NOW + 5_000)];
    const note = staleClearNote(history, events);
    expect(note).toEqual({ from: 0, to: NOW - 10 * DAY });
    // Once History is full again, the noted plays do not come back.
    const m = mergePlays(fullHistory(NOW + DAY), events, { forgotten: [note!] });
    expect(m.entries.some((e) => e.song.id === 'old' || e.song.id === 'older')).toBe(false);
  });

  it('notes every log play when History is empty', () => {
    expect(staleClearNote([], [ev('play', 'a', NOW - DAY), ev('play', 'b', NOW)])).toEqual({ from: 0, to: NOW });
  });

  it('has nothing to note for a full History, matching plays, or plays already noted', () => {
    expect(staleClearNote(fullHistory(NOW), [ev('play', 'old', NOW - 300 * DAY)])).toBeNull();
    expect(staleClearNote([hist('x', NOW)], [ev('play', 'x', NOW + 5_000)])).toBeNull();
    expect(staleClearNote([hist('x', NOW)], [ev('play', 'old', NOW - DAY)], [{ from: 0, to: NOW - DAY }])).toBeNull();
  });
});

describe('ranges', () => {
  it('starts 4 weeks, 6 calendar months, or never back', () => {
    expect(rangeStart('4w', NOW)).toBe(NOW - 28 * DAY);
    expect(new Date(rangeStart('6m', NOW)).getMonth()).toBe(4); // May, from November
    expect(rangeStart('all', NOW)).toBe(-Infinity);
  });

  it('filters plays to the range', () => {
    const entries = [hist('a', NOW - DAY), hist('b', NOW - 40 * DAY), hist('c', NOW - 400 * DAY)];
    expect(inRange(entries, '4w', NOW).map((e) => e.song.id)).toEqual(['a']);
    expect(inRange(entries, '6m', NOW).map((e) => e.song.id)).toEqual(['a', 'b']);
    expect(inRange(entries, 'all', NOW)).toHaveLength(3);
  });
});

describe('mergedCoverage', () => {
  it('is complete while History never filled up', () => {
    const m = mergePlays([hist('x', NOW - 100 * DAY)], []);
    expect(mergedCoverage(m, rangeStart('6m', NOW))).toEqual({ complete: true, since: null, deviceOnlyBefore: null });
  });

  it('reaches back as far as the log once History is full', () => {
    const history = fullHistory(NOW);
    const oldest = NOW - (HISTORY_CAP - 1) * MIN;
    const events = [ev('play', 'old', NOW - 50 * DAY), ...Array.from({ length: 3 }, (_, i) => ev('play', `h${i}`, NOW - i * MIN + 5_000))];
    const m = mergePlays(history, events);
    // 4 weeks: the log started before it, so it is covered; only this device's plays before History's oldest.
    const four = mergedCoverage(m, rangeStart('4w', NOW));
    expect(four).toEqual({ complete: true, since: null, deviceOnlyBefore: oldest });
    expect(mergedCoverageNote(four, 'the last 4 weeks')).toBeNull();
    expect(mergedCoverageNote(four, 'the last 4 weeks', true)).toMatch(/^Before .+, the last 4 weeks counts plays from this device only\.$/);
    // 6 months: the record stops 50 days back.
    const six = mergedCoverage(m, rangeStart('6m', NOW));
    expect(six.complete).toBe(false);
    expect(six.since).toBe(NOW - 50 * DAY);
    expect(mergedCoverageNote(six, 'the last 6 months')).toMatch(/only counts listening since then\.$/);
  });

  it('does not trust a log that hit its row limit beyond its oldest play', () => {
    const history = fullHistory(NOW);
    const events = [ev('queue_add', 'q', NOW - 300 * DAY), ev('play', 'old', NOW - 50 * DAY)];
    const notFull = mergedCoverage(mergePlays(history, events), rangeStart('6m', NOW));
    expect(notFull.complete).toBe(true);
    const full = mergedCoverage(mergePlays(history, events, { limit: 2 }), rangeStart('6m', NOW));
    expect(full.complete).toBe(false);
    expect(full.since).toBe(NOW - 50 * DAY);
  });
});
