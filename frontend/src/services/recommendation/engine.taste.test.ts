// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';
import type { Candidate } from './types';
import { makeContext, makeSong, warmProfile } from '@/__fixtures__/songs';

/**
 * 8.2.0 — what the next-song plan does with its new memories and signals:
 * the same seed does not hand back the same opening twice, songs the
 * catalogue cannot stream never reach the queue (unless downloaded), and the
 * served memory is a penalty, never a rule.
 */
let pool: Candidate[] = [];
vi.mock('./candidates', () => ({ gatherCandidates: vi.fn(async () => pool), generateNextCandidates: vi.fn(async () => pool) }));
vi.mock('@/services/queryClient', () => ({ queryClient: { getQueryData: () => undefined } }));

import { planNextSongs, recommendNextSongs } from './engine';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useDownloadsStore } from '@/store/downloadsStore';
import { recordServed, songKey } from './songIdentity';
import { resetRecMemory } from './recMemory';
import { resetTransitionMemory } from './transitions';

const NOW = 1_800_000_000_000;
const seed = makeSong('seed', { title: 'Seed', artist: 'Sid Sriram' });
const cands = (n: number): Candidate[] => Array.from({ length: n }, (_, i) => ({ song: makeSong(`te${i}`, { artist: `Artist ${i}`, playCount: 5_000_000 - i * 1000 }), source: 'related' as const }));
const ctx = () => makeContext({ profile: warmProfile(NOW), pinnedLanguages: ['telugu'], surface: 'next' });
const ids = (songs: Song[]) => songs.map((s) => s.id);

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetTransitionMemory();
  resetRecMemory();
  useSettingsStore.setState({ kidMode: false, mutedLanguages: [] });
  useLibraryStore.setState({ hiddenSongIds: [], hiddenArtists: [] });
  useDownloadsStore.setState({ items: {} });
});

describe('never the same opening twice', () => {
  it('asking again from the same song, after the first list was accepted, opens differently', async () => {
    pool = cands(16);
    const first = await recommendNextSongs(seed, ctx(), { limit: 5 });
    const second = await recommendNextSongs(seed, ctx(), { limit: 5 });
    expect(first).toHaveLength(5);
    expect(second).toHaveLength(5);
    expect(new Set(ids(second))).not.toEqual(new Set(ids(first)));
  });

  it('remembers nothing for a plan that was never committed', async () => {
    pool = cands(16);
    const a = await planNextSongs(seed, ctx(), { limit: 5 });
    const b = await planNextSongs(seed, ctx(), { limit: 5 });
    expect(ids(b.songs)).toEqual(ids(a.songs));
  });

  it('holds back a song another surface just showed, without banning it', async () => {
    pool = cands(16);
    const before = await planNextSongs(seed, ctx(), { limit: 5 });
    recordServed([songKey(before.songs[0])]);
    const after = await planNextSongs(seed, ctx(), { limit: 5 });
    expect(after.songs.findIndex((s) => s.id === before.songs[0].id)).not.toBe(0);
    // A pool of one: the shown song is still offered.
    pool = cands(1);
    const alone = await planNextSongs(seed, ctx(), { limit: 5 });
    expect(ids(alone.songs)).toEqual(['te0']);
  });
});

describe('songs that cannot stream', () => {
  it('never reach the queue, unless they are downloaded', async () => {
    pool = [...cands(10), { song: makeSong('mute', { artist: 'Mute', playCount: 99_000_000 }), source: 'related', unplayable: true }];
    expect(ids((await planNextSongs(seed, ctx(), { limit: 8 })).songs)).not.toContain('mute');
    useDownloadsStore.setState({ items: { mute: { song: pool[10].song, addedAt: NOW } } });
    expect(ids((await planNextSongs(seed, ctx(), { limit: 8 })).songs)).toContain('mute');
  });
});
