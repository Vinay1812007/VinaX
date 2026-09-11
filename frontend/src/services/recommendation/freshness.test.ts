// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { Song } from '@/types';
import { freshSongs } from './freshness';
import { recordServed, servedKeySet, songKey } from './flow';

const track = (id: string, title = id, language = 'telugu'): Song => ({
  kind: 'song',
  id,
  title,
  subtitle: 'Artist',
  artists: [{ id: 'artist', name: 'Artist' }],
  album: null,
  images: [],
  audio: [],
  duration: 200,
  language,
  year: null,
  explicit: false,
  hasLyrics: false,
  playCount: null,
});
beforeEach(() => localStorage.clear());

describe('all-path queue freshness', () => {
  it('rejects alternate releases of queued/history songs and duplicate candidates', () => {
    const original = track('old', 'Orbit');
    const candidates = [
      track('reissue', 'Orbit (2025 Remaster)'),
      track('new', 'Starlight'),
      track('duplicate', 'Starlight (From "Film")'),
    ];
    expect(
      freshSongs(candidates, { excludeKeys: new Set([songKey(original)]) }).map((s) => s.id),
    ).toEqual(['new']);
  });
  it('never relaxes language, blocked songs or junk to fill a small pool', () => {
    const songs = [
      track('valid'),
      track('muted', 'Muted', 'hindi'),
      track('unknown', 'Unknown', 'unknown'),
      track('blocked'),
      track('junk', 'Movie trailer'),
      { ...track('short'), duration: 40 },
    ];
    expect(
      freshSongs(songs, {
        language: 'telugu',
        muted: ['hindi'],
        blocked: (s) => s.id === 'blocked',
      }).map((s) => s.id),
    ).toEqual(['valid']);
  });
  it('remembers served identities across rounds', () => {
    const first = track('first', 'Orbit');
    recordServed([songKey(first)]);
    expect(
      freshSongs([track('alternate', 'Orbit (Remix)'), track('fresh')], {
        excludeKeys: servedKeySet(),
      }).map((s) => s.id),
    ).toEqual(['fresh']);
  });
  it('expires old served memory without admitting corrupt timestamps', () => {
    localStorage.setItem(
      'vinax.flow.served.v1',
      JSON.stringify([
        { k: 'old', t: Date.now() - 8 * 86400000 },
        { k: 'recent', t: Date.now() },
        { k: 'bad', t: 'yesterday' },
      ]),
    );
    expect([...servedKeySet()]).toEqual(['recent']);
  });
});
