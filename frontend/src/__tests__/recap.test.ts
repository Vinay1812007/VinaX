/**
 * "Your Year in Music" engine — pure on-device math over the taste profile +
 * recent history. Pins the honesty rules: lifetime counts stated as facts,
 * minutes always an estimate, "on repeat" needs 2+ recent plays, and the
 * recap hides until there's real signal.
 */
import { describe, expect, it } from 'vitest';
import type { HistoryEntry, Song } from '@/types';
import { createEmptyProfile, type TasteProfile } from '../services/personalization/profile';
import { buildRecap, recapReady } from '../features/recap/recap';

const NOW = new Date(2026, 7, 11).getTime(); // Aug 11 2026, local

function song(id: string, title: string, duration = 200): Song {
  return {
    kind: 'song', id, title, subtitle: 'Artist', artists: [], album: null,
    images: [], audio: [], duration, language: 'telugu', year: '2024',
    explicit: false, hasLyrics: false, playCount: null,
  };
}
const entry = (s: Song): HistoryEntry => ({ song: s, ts: NOW - 60_000, completed: true });

function profileWith(plays: number): TasteProfile {
  const p = createEmptyProfile(NOW - 100 * 86_400_000); // born 100 days ago
  p.totals.plays = plays;
  p.totals.completes = Math.floor(plays * 0.8);
  p.totals.skips = Math.floor(plays * 0.05);
  p.artists['anirudh'] = { name: 'Anirudh', score: 5, plays: 40, completes: 30, skips: 1, lastTs: NOW };
  p.artists['dsp'] = { name: 'DSP', score: 3, plays: 25, completes: 20, skips: 1, lastTs: NOW };
  p.languages['telugu'] = { score: 5, plays: 60, completes: 50, skips: 2, lastTs: NOW };
  p.languages['hindi'] = { score: 2, plays: 20, completes: 15, skips: 1, lastTs: NOW };
  return p;
}

describe('buildRecap', () => {
  it('states lifetime facts and estimates minutes from real durations', () => {
    const h = [entry(song('a', 'A', 300)), entry(song('b', 'B', 300))];
    const r = buildRecap(profileWith(100), h, 7, NOW);
    expect(r.totalPlays).toBe(100);
    expect(r.favorites).toBe(7);
    expect(r.estMinutes).toBe(Math.round((100 * 300) / 60)); // avg 300s × 100 plays
    expect(r.year).toBe(2026);
    expect(r.daysTogether).toBeGreaterThanOrEqual(100);
  });

  it('ranks artists and normalizes language shares to ~100', () => {
    const r = buildRecap(profileWith(100), [], 0, NOW);
    expect(r.topArtists[0].name).toBe('Anirudh');
    expect(r.topArtists[0].plays).toBe(40);
    const pctSum = r.topLanguages.reduce((n, l) => n + l.pct, 0);
    expect(pctSum).toBeGreaterThanOrEqual(98);
    expect(pctSum).toBeLessThanOrEqual(102);
  });

  it('"on repeat" needs 2+ recent plays; a single play never qualifies', () => {
    const twice = [entry(song('x', 'Hit')), entry(song('x', 'Hit')), entry(song('y', 'Once'))];
    expect(buildRecap(profileWith(50), twice, 0, NOW).onRepeat?.title).toBe('Hit');
    const once = [entry(song('y', 'Once'))];
    expect(buildRecap(profileWith(50), once, 0, NOW).onRepeat).toBeNull();
  });

  it('empty history still produces a sane estimate (fallback track length)', () => {
    const r = buildRecap(profileWith(60), [], 0, NOW);
    expect(r.estMinutes).toBe(Math.round((60 * 210) / 60));
    expect(Number.isFinite(r.estMinutes)).toBe(true);
  });

  it('daysTogether never exceeds the current year for old profiles', () => {
    const old = profileWith(100);
    old.createdAt = new Date(2024, 0, 1).getTime();
    const r = buildRecap(old, [], 0, NOW);
    const dayOfYear = Math.ceil((NOW - new Date(2026, 0, 1).getTime()) / 86_400_000);
    expect(r.daysTogether).toBeLessThanOrEqual(dayOfYear + 1);
  });
});

describe('recapReady', () => {
  it('hides the recap until ~20 plays with at least one known artist', () => {
    expect(recapReady(buildRecap(profileWith(100), [], 0, NOW))).toBe(true);
    const cold = createEmptyProfile(NOW);
    cold.totals.plays = 5;
    expect(recapReady(buildRecap(cold, [], 0, NOW))).toBe(false);
  });
});
