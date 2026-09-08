import { describe, expect, it } from 'vitest';
import { songOfTheDay } from './songOfTheDay';
import type { HistoryEntry, Song } from '@/types';

const song = (id: string): Song => ({
  kind: 'song', id, title: id, subtitle: 'A', artists: [], album: null, images: [], audio: [], duration: 200,
  language: null, year: null, explicit: false, hasLyrics: false, playCount: null,
});
const at = (y: number, m: number, d: number) => new Date(y, m, d, 12).getTime();
const play = (id: string, ts: number, completed = true): HistoryEntry => ({ song: song(id), ts, completed });

describe('songOfTheDay (v5.17.0)', () => {
  it('returns null with nothing to pick from (unfinished plays do not count)', () => {
    expect(songOfTheDay([], [], '2026-09-09')).toBeNull();
    expect(songOfTheDay([], [play('a', at(2026, 8, 1), false)], '2026-09-09')).toBeNull();
  });

  it('is deterministic for a date and independent of input order', () => {
    const favs = [song('a'), song('b'), song('c')];
    const hist = [play('d', at(2026, 8, 1)), play('e', at(2026, 8, 2))];
    const p1 = songOfTheDay(favs, hist, '2026-09-09');
    const p2 = songOfTheDay([...favs].reverse(), [...hist].reverse(), '2026-09-09');
    expect(p1?.song.id).toBe(p2?.song.id);
    const days = new Set(['2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13'].map((k) => songOfTheDay(favs, hist, k)?.song.id));
    expect(days.size).toBeGreaterThan(1);
  });

  it('explains the pick', () => {
    const hist = [play('a', at(2026, 2, 3)), play('a', at(2026, 2, 4)), play('a', at(2026, 3, 1), false), play('a', at(2026, 3, 2))];
    expect(songOfTheDay([], hist, '2026-09-09')?.reason).toBe('You finished it 3 times');
    expect(songOfTheDay([song('b')], [play('b', at(2026, 2, 3), false)], '2026-09-09')?.reason).toBe('A favourite from March');
    expect(songOfTheDay([song('b')], [], '2026-09-09')?.reason).toBe('One of your favourites');
    expect(songOfTheDay([], [play('c', at(2026, 2, 3))], '2026-09-09')?.reason).toBe('You finished it once');
  });
});
