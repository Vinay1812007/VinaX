import { describe, it, expect } from 'vitest';
import { TUNE_OPTIONS, tunePromptHint, tuneScoreAdjust, type TuneIntent } from './tune';
import type { Song } from '../../types';

function song(over: Partial<Song> = {}): Song {
  return {
    kind: 'song',
    id: 'x',
    title: 'T',
    subtitle: 'A',
    artists: [],
    album: null,
    images: [],
    audio: [],
    duration: 100,
    language: 'telugu',
    year: null,
    explicit: false,
    hasLyrics: false,
    playCount: null,
    ...over,
  };
}

const YEAR = new Date().getFullYear();

describe('TUNE_OPTIONS', () => {
  it('exposes 12 distinct intents, each with a label', () => {
    expect(TUNE_OPTIONS.length).toBe(12);
    expect(new Set(TUNE_OPTIONS.map((o) => o.id)).size).toBe(12);
    expect(TUNE_OPTIONS.every((o) => o.label.length > 0)).toBe(true);
  });
});

describe('tunePromptHint', () => {
  it('returns a non-empty hint for every option', () => {
    for (const o of TUNE_OPTIONS) expect(tunePromptHint(o.id).length).toBeGreaterThan(0);
  });
});

describe('tuneScoreAdjust', () => {
  it('classics boosts old, demotes new', () => {
    expect(tuneScoreAdjust(song({ year: String(YEAR - 20) }), 'classics', 'telugu')).toBeGreaterThan(0);
    expect(tuneScoreAdjust(song({ year: String(YEAR) }), 'classics', 'telugu')).toBeLessThan(0);
  });
  it('fresh boosts new, demotes old', () => {
    expect(tuneScoreAdjust(song({ year: String(YEAR) }), 'fresh', 'telugu')).toBeGreaterThan(0);
    expect(tuneScoreAdjust(song({ year: String(YEAR - 20) }), 'fresh', 'telugu')).toBeLessThan(0);
  });
  it('same-language rewards a match, penalizes others', () => {
    expect(tuneScoreAdjust(song({ language: 'telugu' }), 'same-language', 'telugu')).toBeGreaterThan(0);
    expect(tuneScoreAdjust(song({ language: 'hindi' }), 'same-language', 'telugu')).toBeLessThan(0);
  });
  it('different-language rewards a different language', () => {
    expect(tuneScoreAdjust(song({ language: 'hindi' }), 'different-language', 'telugu')).toBeGreaterThan(0);
    expect(tuneScoreAdjust(song({ language: 'telugu' }), 'different-language', 'telugu')).toBeLessThan(0);
  });
  it('mood intents are AI-driven (no deterministic nudge)', () => {
    for (const i of ['energetic', 'chill', 'romantic', 'surprise'] as TuneIntent[]) {
      expect(tuneScoreAdjust(song(), i, 'telugu')).toBe(0);
    }
  });
});
