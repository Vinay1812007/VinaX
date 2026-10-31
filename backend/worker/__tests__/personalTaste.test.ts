/**
 * The taste fold: the device's weights, decay, caps, order independence,
 * the hours histogram and the summary the composer reads.
 */
import { describe, expect, it } from 'vitest';
import { decayTaste, emptyTaste, EVENT_WEIGHTS, foldEvents, MAX_SONGS, summarize, tasteLanguages, tasteTopArtistWithId } from '../functions/_lib/personal/taste';
import type { PersonalEvent, SongFacts } from '../functions/_lib/personal/types';

const NOW = Date.UTC(2026, 9, 31, 12);
const DAY = 86_400_000;

const song = (id: string, over: Partial<SongFacts> = {}): SongFacts => ({
  id, title: `Song ${id}`, artist: 'Sid Sriram', artistId: 'ar1', artists: [{ id: 'ar1', name: 'Sid Sriram' }],
  album: 'Album', albumId: 'al1', language: 'telugu', year: 2021, duration: 240, image: null, facets: { mood: 'romantic' }, ...over,
});
const ev = (id: string, kind: PersonalEvent['kind'], songId: string, at = NOW, extra: Partial<PersonalEvent> = {}): PersonalEvent => ({ id, kind, songId, at, ...extra });
const songs = (...list: SongFacts[]) => new Map(list.map((s) => [s.id, s]));

describe('foldEvents', () => {
  it('moves song, artist and language affinities by the device weights', () => {
    const t = foldEvents(emptyTaste(NOW), [ev('e1', 'play', 's1'), ev('e2', 'complete', 's1'), ev('e3', 'like', 's1')], songs(song('s1')), NOW);
    const expected = EVENT_WEIGHTS.play + EVENT_WEIGHTS.complete + EVENT_WEIGHTS.like;
    expect(t.songs.s1.score).toBeCloseTo(expected);
    expect(t.songs.s1).toMatchObject({ plays: 1, completes: 1, likes: 1, skips: 0 });
    expect(t.artists.ar1.score).toBeCloseTo(expected);
    expect(t.artists.ar1.name).toBe('Sid Sriram');
    expect(t.languages.telugu.score).toBeCloseTo(expected);
    expect(t.facets.moods.romantic).toBeCloseTo(expected);
    expect(t.facets.decades['2020s']).toBeCloseTo(expected);
    expect(t.eventsSeen).toBe(3);
    expect(t.version).toBe(1);
  });

  it('a skip takes its play back; a dislike pushes below zero; unlike undoes a like', () => {
    const t = foldEvents(emptyTaste(NOW), [ev('e1', 'play', 's1'), ev('e2', 'skip', 's1', NOW + 1), ev('e3', 'like', 's2'), ev('e4', 'unlike', 's2', NOW + 1), ev('e5', 'dislike', 's3')], songs(song('s1'), song('s2'), song('s3')), NOW + 2);
    expect(t.songs.s1.score).toBeLessThan(0);
    expect(t.songs.s1.skips).toBe(1);
    expect(t.songs.s2.score).toBeCloseTo(0);
    expect(t.songs.s2.likes).toBe(0);
    expect(t.songs.s3.score).toBeCloseTo(EVENT_WEIGHTS.dislike);
  });

  it('secondary artists get half the weight; a song without facts still counts for itself', () => {
    const two = song('s1', { artists: [{ id: 'ar1', name: 'A' }, { id: 'ar2', name: 'B' }] });
    const t = foldEvents(emptyTaste(NOW), [ev('e1', 'complete', 's1'), ev('e2', 'play', 'unknown')], songs(two), NOW);
    expect(t.artists.ar1.score).toBeCloseTo(2);
    expect(t.artists.ar2.score).toBeCloseTo(1);
    expect(t.songs.unknown.score).toBeCloseTo(1);
    expect(t.languages.telugu).toBeDefined();
  });

  it('gives the same model whatever order the batch arrives in', () => {
    const batch = [ev('e1', 'play', 's1', NOW - 3000), ev('e2', 'like', 's2', NOW - 2000), ev('e3', 'skip', 's1', NOW - 1000), ev('e4', 'complete', 's2', NOW)];
    const a = foldEvents(emptyTaste(NOW - DAY), batch, songs(song('s1'), song('s2')), NOW);
    const b = foldEvents(emptyTaste(NOW - DAY), [...batch].reverse(), songs(song('s1'), song('s2')), NOW);
    expect(a).toEqual(b);
  });

  it('does not touch the model it was given', () => {
    const start = emptyTaste(NOW);
    foldEvents(start, [ev('e1', 'play', 's1')], songs(song('s1')), NOW);
    expect(start.songs).toEqual({});
  });

  it('halves positive scores every 14 days and skip counts every 30', () => {
    const t = foldEvents(emptyTaste(NOW), [ev('e1', 'like', 's1'), ev('e2', 'skip', 's2')], songs(song('s1'), song('s2')), NOW);
    const later = decayTaste(structuredClone(t), NOW + 14 * DAY);
    expect(later.songs.s1.score).toBeCloseTo(t.songs.s1.score / 2, 5);
    expect(later.songs.s2.skips).toBeCloseTo(Math.pow(0.5, 14 / 30), 5);
    expect(later.facets.moods.romantic).toBeCloseTo(t.facets.moods.romantic / 2, 5);
    const soon = decayTaste(structuredClone(t), NOW + 3_600_000);
    expect(soon.songs.s1.score).toBe(t.songs.s1.score);
  });

  it('keeps the newest MAX_SONGS songs and caps a score at 60', () => {
    const events = Array.from({ length: MAX_SONGS + 50 }, (_, i) => ev(`e${i}`, 'play', `s${i}`, NOW - (MAX_SONGS + 50 - i) * 1000));
    const t = foldEvents(emptyTaste(NOW - DAY), events, new Map(), NOW);
    expect(Object.keys(t.songs)).toHaveLength(MAX_SONGS);
    expect(t.songs.s0).toBeUndefined();
    expect(t.songs[`s${MAX_SONGS + 49}`]).toBeDefined();
    const binge = foldEvents(emptyTaste(NOW), Array.from({ length: 40 }, (_, i) => ev(`l${i}`, 'like', 's1', NOW + i)), songs(song('s1')), NOW + 100);
    expect(binge.songs.s1.score).toBe(60);
  });

  it('fills the hours histogram per language and overall from the device clock', () => {
    const t = foldEvents(emptyTaste(NOW), [ev('e1', 'play', 's1', NOW, { context: { hour: 22 } }), ev('e2', 'play', 's2', NOW, { context: { hour: 22 } }), ev('e3', 'complete', 's2', NOW, { context: { hour: 8 } })],
      songs(song('s1'), song('s2', { language: 'hindi' })), NOW);
    expect(t.hours._all[22]).toBe(2);
    expect(t.hours._all[8]).toBe(1);
    expect(t.hours.telugu[22]).toBe(1);
    expect(t.hours.hindi[8]).toBe(1);
  });
});

describe('summarize', () => {
  it('writes the lines the composer reads', () => {
    const t = foldEvents(emptyTaste(NOW), [
      ev('e1', 'like', 's1', NOW, { context: { hour: 21 } }), ev('e2', 'complete', 's1', NOW, { context: { hour: 21 } }),
      ev('e3', 'play', 's2', NOW, { context: { hour: 22 } }), ev('e4', 'skip', 's3', NOW),
    ], songs(song('s1'), song('s2', { language: 'hindi', artistId: 'ar2', artist: 'Arijit', artists: [{ id: 'ar2', name: 'Arijit' }], year: 2012 }), song('s3')), NOW);
    const s = summarize(t);
    expect(s.topArtists[0]).toMatchObject({ id: 'ar1', name: 'Sid Sriram' });
    expect(s.topLanguages[0].id).toBe('telugu');
    expect(s.topLanguages.map((l) => l.id)).toContain('hindi');
    expect(s.moods).toEqual(['romantic']);
    expect(s.peakHours).toContain(21);
    expect(s.totals).toMatchObject({ plays: 1, completes: 1, likes: 1, skips: 1 });
    expect(s.lines.join(' ')).toMatch(/Listens mostly to telugu/);
    expect(s.lines.join(' ')).toMatch(/Top artists: Sid Sriram/);
    expect(s.lines.join(' ')).toMatch(/evening|night/);
    expect(tasteLanguages(t)).toEqual(['telugu', 'hindi']);
    expect(tasteTopArtistWithId(t)).toMatchObject({ id: 'ar1', name: 'Sid Sriram' });
  });

  it('says nothing for an empty model', () => {
    expect(summarize(emptyTaste(NOW)).lines).toEqual([]);
  });
});
