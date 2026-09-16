import { describe, expect, it } from 'vitest';
import type { Song } from '@/types';
import { TUNE_OPTIONS, isTuneIntent, randomTune, tunePromptHint, tuneScoreAdjust, tuneShape } from './tune';

const song = (extra: Partial<Song>): Song => ({
  kind: 'song', id: 'x', title: 'Song', subtitle: 'A', artists: [{ id: 'a', name: 'A' }], album: null, images: [], audio: [],
  duration: 200, language: 'telugu', year: '2020', explicit: false, hasLyrics: false, playCount: null, ...extra,
});
const YEAR = new Date().getFullYear();

describe('tune intents', () => {
  it('every option has a prompt hint and Surprise resolves to a concrete intent', () => {
    for (const o of TUNE_OPTIONS) expect(tunePromptHint(o.id).length).toBeGreaterThan(10);
    expect(isTuneIntent('chill')).toBe(true);
    expect(isTuneIntent('nope')).toBe(false);
    for (let i = 0; i < 20; i += 1) expect(randomTune()).not.toBe('surprise');
  });

  it('nudges era and language deterministically from catalogue metadata', () => {
    expect(tuneScoreAdjust(song({ year: String(YEAR - 12) }), 'classics', 'telugu')).toBeGreaterThan(0);
    expect(tuneScoreAdjust(song({ year: String(YEAR) }), 'classics', 'telugu')).toBeLessThan(0);
    expect(tuneScoreAdjust(song({ year: String(YEAR) }), 'fresh', 'telugu')).toBeGreaterThan(0);
    expect(tuneScoreAdjust(song({ year: null }), 'fresh', 'telugu')).toBe(0);
    expect(tuneScoreAdjust(song({ language: 'hindi' }), 'same-language', 'telugu')).toBeLessThan(0);
    expect(tuneScoreAdjust(song({ language: 'hindi' }), 'different-language', 'telugu')).toBeGreaterThan(0);
    expect(tuneScoreAdjust(song({ language: 'telugu' }), 'different-language', null)).toBe(0);
  });

  it('uses the classifier energy for energetic / chill and title cues for the rest', () => {
    expect(tuneScoreAdjust(song({ energy: 0.9 }), 'energetic', null)).toBeGreaterThan(0);
    expect(tuneScoreAdjust(song({ energy: 0.9 }), 'chill', null)).toBeLessThan(0);
    expect(tuneScoreAdjust(song({ energy: null }), 'energetic', null)).toBe(0);
    expect(tuneScoreAdjust(song({ title: 'Shiva Bhajan' }), 'devotional', null)).toBeGreaterThan(0);
    expect(tuneScoreAdjust(song({ title: 'Plain Song' }), 'romantic', null)).toBe(0);
  });

  it('maps intents to arc shapes', () => {
    expect(tuneShape('energetic')).toBe('build');
    expect(tuneShape('chill')).toBe('wind-down');
    expect(tuneShape('surprise')).toBe('wave');
    expect(tuneShape('classics')).toBeNull();
  });
});
