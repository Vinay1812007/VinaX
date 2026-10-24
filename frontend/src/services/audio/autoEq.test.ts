import { describe, expect, it } from 'vitest';
import { presetForSong } from './autoEq';

describe('15.0 — Auto EQ picks a preset from the song itself', () => {
  it('reads genre, vibe and mood words', () => {
    expect(presetForSong({ genre: 'Hip-Hop', title: 'x', album: { id: 'a', name: 'A' } })).toBe('bass');
    expect(presetForSong({ genres: ['Romantic'], mood: 'soft', title: 'x', album: { id: 'a', name: 'A' } })).toBe('vocal');
    expect(presetForSong({ vibes: ['mass', 'dance'], title: 'x', album: { id: 'a', name: 'A' } })).toBe('loud');
    expect(presetForSong({ genre: 'Folk', title: 'x', album: { id: 'a', name: 'A' } })).toBe('treble');
    expect(presetForSong({ genre: 'Podcast', title: 'x', album: { id: 'a', name: 'A' } })).toBe('podcast');
  });
  it('falls back to measured energy and tempo, and stays quiet otherwise', () => {
    expect(presetForSong({ energy: 0.9, tempo: 130, title: 'x', album: { id: 'a', name: 'A' } })).toBe('bass');
    expect(presetForSong({ energy: 0.9, tempo: 90, title: 'x', album: { id: 'a', name: 'A' } })).toBe('loud');
    expect(presetForSong({ energy: 0.2, title: 'x', album: { id: 'a', name: 'A' } })).toBe('vocal');
    expect(presetForSong({ title: 'x', album: { id: 'a', name: 'A' } })).toBeNull();
    expect(presetForSong(null)).toBeNull();
  });
});
