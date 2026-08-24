// @vitest-environment jsdom
/** Locks the taste snapshot's day-by-day learning (v3.3.0): plays inside the
 *  last two weeks outrank an older binge, so the profile every AI payload
 *  carries actually follows the listener week to week. */
import { beforeEach, describe, expect, it } from 'vitest';
import { buildTasteSnapshot } from './taste';
import { useHistoryStore } from '@/store/historyStore';
import { useLibraryStore } from '@/store/libraryStore';
import type { Song } from '@/types';

const DAY = 86_400_000;

const song = (id: string, title: string, artist: string): Song =>
  ({
    id,
    title,
    subtitle: artist,
    artists: [{ id: `a-${artist}`, name: artist }],
  }) as unknown as Song;

const entry = (s: Song, ageDays: number, now: number) => ({
  song: s,
  ts: now - ageDays * DAY,
  completed: true,
});

beforeEach(() => {
  useHistoryStore.setState({ entries: [] });
  useLibraryStore.setState({ favorites: [] } as unknown as Parameters<typeof useLibraryStore.setState>[0]);
});

describe('buildTasteSnapshot — 14-day recency weighting', () => {
  it('a song played twice this week outranks one played three times last month', () => {
    const now = Date.now();
    const fresh = song('s1', 'Fresh Song', 'New Artist');
    const stale = song('s2', 'Old Song', 'Old Artist');
    useHistoryStore.setState({
      entries: [
        entry(fresh, 1, now),
        entry(fresh, 2, now),
        entry(stale, 30, now),
        entry(stale, 31, now),
        entry(stale, 32, now),
      ],
    });
    const snap = buildTasteSnapshot(now);
    // fresh: 2 plays × 3 (recent) = 6 · stale: 3 plays × 1 = 3
    expect(snap.topSongs[0]).toBe('Fresh Song — New Artist');
    expect(snap.topArtists[0]).toBe('New Artist');
  });

  it('still counts older history when nothing recent exists', () => {
    const now = Date.now();
    const stale = song('s3', 'Evergreen', 'Classic Artist');
    useHistoryStore.setState({ entries: [entry(stale, 40, now), entry(stale, 41, now)] });
    const snap = buildTasteSnapshot(now);
    expect(snap.topSongs[0]).toBe('Evergreen — Classic Artist');
    expect(snap.topArtists).toContain('Classic Artist');
  });
});
