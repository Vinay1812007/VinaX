// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';

vi.mock('@/services/recs/similar', () => ({ recommendFromSeeds: vi.fn(async () => []) }));
vi.mock('@/features/social/resolve', () => ({ resolveSongs: vi.fn(async () => []) }));

import { useLibraryStore } from '@/store/libraryStore';
import { blendFor, buildBlend, mineKey, mixBlend, needsRefresh, roundRobin, saveBlend, seedBatches, theirsKey, useBlendStore, type BlendDeps } from './blend';
import { parseHandle } from './handle';

const song = (id: string, artist = 'Someone'): Song => ({ kind: 'song', id, title: id, subtitle: artist, artists: [{ id: artist, name: artist }], images: [], language: 'telugu' } as unknown as Song);
const songs = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => song(`${prefix}${i}`));

beforeEach(() => {
  localStorage.clear();
  useLibraryStore.setState({ favorites: [], collections: [], hiddenSongIds: [], hiddenArtists: [] } as never);
  useBlendStore.setState({ blends: {} });
});

describe('Blend — the mix', () => {
  it('cuts seeds into batches of five, at most two per side', () => {
    expect(seedBatches(songs('a', 12)).map((b) => b.length)).toEqual([5, 5]);
    expect(seedBatches(songs('a', 7)).map((b) => b.length)).toEqual([5, 2]);
    expect(seedBatches([])).toEqual([]);
  });

  it('takes turns between lists', () => {
    expect(roundRobin([[1, 2, 3], [10], [20, 21]])).toEqual([1, 10, 20, 2, 21, 3]);
  });

  it('leads with songs both like, alternates sides, and tags where each came from', () => {
    const shared = song('both1');
    const r = mixBlend({
      theirLikes: [song('t1'), shared],
      myLikes: [shared, song('m1')],
      theirPicks: [[song('tp1'), song('dup')]],
      myPicks: [[song('mp1'), song('dup')]],
    });
    expect(r.songs[0].id).toBe('both1');
    expect(r.from).toMatchObject({ both1: 'both', t1: 'theirs', m1: 'mine', tp1: 'theirs', mp1: 'mine', dup: 'both' });
    // No song twice.
    expect(new Set(r.songs.map((s) => s.id)).size).toBe(r.songs.length);
    // Their side and yours take turns after the shared lead.
    expect(r.songs.slice(1, 3).map((s) => r.from[s.id])).toEqual(['theirs', 'mine']);
  });

  it('leaves out what skip says and stops at max', () => {
    const r = mixBlend({ theirLikes: songs('t', 30), myLikes: songs('m', 30), theirPicks: [], myPicks: [], max: 10, skip: (s) => s.id === 't0' });
    expect(r.songs).toHaveLength(10);
    expect(r.from.t0).toBeUndefined();
  });

  it('asks the catalogue once per five seeds: two batches of theirs (any language) and two of yours', async () => {
    const recommend = vi.fn(async (seeds: Song[]) => [song(`pick-${seeds[0].id}`)]) as unknown as BlendDeps['recommend'];
    const resolve = vi.fn(async () => songs('t', 20));
    const r = await buildBlend(songs('t', 20).map((s) => ({ id: s.id })), songs('m', 15), { resolve, recommend });
    expect(resolve).toHaveBeenCalledWith(expect.any(Array), 10);
    const calls = (recommend as unknown as ReturnType<typeof vi.fn>).mock.calls as Array<[Song[], { languages?: string[]; exclude: string[] }]>;
    expect(calls).toHaveLength(4);
    for (const [seeds] of calls) expect(seeds.length).toBeLessThanOrEqual(5);
    expect(calls.filter(([, o]) => Array.isArray(o.languages) && o.languages.length === 0)).toHaveLength(2);
    // Every like is left out of the picks.
    expect(calls[0][1].exclude).toEqual(expect.arrayContaining(['t0', 't9', 'm0', 'm9']));
    expect(r.from['pick-t0']).toBe('theirs');
    expect(r.from['pick-m5']).toBe('mine');
  });

  it('a failed call brings nothing, the likes still count', async () => {
    const recommend = vi.fn(async () => { throw new Error('down'); }) as unknown as BlendDeps['recommend'];
    const r = await buildBlend([{ id: 't0' }], [song('m0')], { resolve: async () => [song('t0')], recommend });
    expect(r.songs.map((s) => s.id).sort()).toEqual(['m0', 't0']);
  });
});

describe('Blend — the saved playlist', () => {
  const friend = { handle: 'bobo', name: 'Bobo', updatedAt: '2026-11-01T00:00:00.000Z' };

  it('saves "Blend with <name>", remembers where songs came from, and refreshes in place keeping songs added by hand', () => {
    const favs = [song('m0')];
    const rec = saveBlend(friend, { songs: [song('a'), song('b')], from: { a: 'theirs', b: 'mine' } }, favs, 1000)!;
    const lib = () => useLibraryStore.getState().collections;
    expect(lib()).toHaveLength(1);
    expect(lib()[0].name).toBe('Blend with Bobo');
    expect(lib()[0].tags).toEqual(['blend']);
    expect(blendFor('bobo')).toMatchObject({ collectionId: rec.collectionId, theirsAt: friend.updatedAt, mineKey: 'm0', from: { a: 'theirs' } });
    // The listener adds a song by hand.
    useLibraryStore.setState((s) => ({ collections: s.collections.map((c) => ({ ...c, songs: [...c.songs, song('mine-by-hand')] })) }));
    saveBlend({ ...friend, updatedAt: '2026-11-02T00:00:00.000Z' }, { songs: [song('c')], from: { c: 'theirs' } }, favs, 2000);
    expect(lib()).toHaveLength(1);
    expect(lib()[0].songs.map((s) => s.id)).toEqual(['c', 'mine-by-hand']);
    expect(blendFor('bobo')?.builtAt).toBe(2000);
  });

  it('is rebuilt when their likes or your newest likes change, and forgotten once the playlist is deleted', () => {
    const favs = [song('m0'), song('m1')];
    const theirs = { ...friend, recentLikes: [{ id: 't1' }, { id: 't2' }] };
    const rec = saveBlend(theirs, { songs: [song('a')], from: { a: 'theirs' } }, favs)!;
    expect(rec.theirsKey).toBe('t1,t2');
    expect(needsRefresh(rec, theirs, favs)).toBe(false);
    // A newer profile with the same likes (they only sent what they are playing): nothing to rebuild.
    expect(needsRefresh(rec, { ...theirs, updatedAt: '2026-11-05T00:00:00.000Z' }, favs)).toBe(false);
    expect(needsRefresh(rec, { updatedAt: '2026-11-05T00:00:00.000Z', recentLikes: [{ id: 't0' }, { id: 't1' }, { id: 't2' }] }, favs)).toBe(true);
    expect(needsRefresh(rec, theirs, [song('new'), ...favs])).toBe(true);
    expect(theirsKey(Array.from({ length: 20 }, (_, i) => ({ id: `x${i}` }))).split(',')).toHaveLength(10);
    expect(mineKey(songs('m', 15)).split(',')).toHaveLength(10);
    useLibraryStore.getState().deleteCollection(rec.collectionId);
    expect(blendFor('bobo')).toBeNull();
  });
});

describe('Find by handle', () => {
  it('reads a handle, @handle, /u/handle or a profile link', () => {
    expect(parseHandle('Bobo_1')).toBe('bobo_1');
    expect(parseHandle('  @bobo ')).toBe('bobo');
    expect(parseHandle('/u/bobo')).toBe('bobo');
    expect(parseHandle('https://www.vinaxmusic.online/u/Bobo?x=1')).toBe('bobo');
  });

  it('refuses what cannot be a handle', () => {
    expect(parseHandle('')).toBeNull();
    expect(parseHandle('ab')).toBeNull();
    expect(parseHandle('bo bo')).toBeNull();
    expect(parseHandle('a'.repeat(21))).toBeNull();
  });
});
