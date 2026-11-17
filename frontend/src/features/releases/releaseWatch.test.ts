// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';

/** What the catalogue answers for the newest-first path: a wrapper JSON body, or a rejection. */
let latestAnswer: () => unknown = () => ({ success: true, data: { total: 0, songs: [] } });
const requested: string[] = [];
vi.mock('@/services/api/client', () => ({
  orchestratedRequest: async (req: { paths: string[]; validate: (json: unknown) => unknown }) => {
    requested.push(...req.paths);
    const out = req.validate(latestAnswer());
    if (out === null) throw new Error('no usable data');
    return out;
  },
}));
const topSongs = vi.fn(async (_id: string, _page?: number): Promise<Song[]> => []);
vi.mock('@/services/api/saavn', () => ({ getArtistTopSongs: (id: string, page?: number) => topSongs(id, page) }));
vi.mock('@/services/native', () => ({ isNativePlatform: () => false }));

import { useLibraryStore } from '@/store/libraryStore';
import { checkReleases, findNew, getArtistLatestSongs, isSeeded, readArtist, useReleaseStore } from './releaseWatch';

const year = String(new Date().getFullYear());
const s = (id: string, y: string): Song => ({ id, year: y } as unknown as Song);
const raw = (id: string, y = year) => ({ id, name: `Song ${id}`, year: y });
/** The VinaX Music API's sorted answer (it carries `total`). */
const wrapper = (...songs: object[]) => ({ success: true, data: { total: 5000, songs } });
/** The Worker's built-in fallback: top songs, no `total`, whatever the sort asked. */
const direct = (...songs: object[]) => ({ success: true, data: { songs } });
const song = (id: string, y = year) => ({ kind: 'song', id, title: `Song ${id}`, year: y } as unknown as Song);

const ids = () => useReleaseStore.getState().fresh.map((f) => f.song.id);

describe('15.0 — release alerts', () => {
  it('the first look only seeds: nothing is new', () => {
    expect(findNew([s('a', '2026')], undefined, 2026)).toEqual([]);
  });
  it('a song from this year that was not seen before is new; older or seen ones are not', () => {
    const now = [s('a', '2026'), s('b', '2026'), s('c', '2019')];
    expect(findNew(now, ['a'], 2026).map((x) => x.id)).toEqual(['b']);
  });
});

describe('1.16 — release alerts read the newest songs first', () => {
  beforeEach(() => {
    localStorage.clear();
    requested.length = 0;
    topSongs.mockReset();
    topSongs.mockResolvedValue([]);
    latestAnswer = () => wrapper();
    useReleaseStore.setState({ seen: {}, seeded: {}, fresh: [], checkedAt: 0 });
    useLibraryStore.setState({ saved: [{ id: 'ar1', kind: 'artist', title: 'Arijit Singh', subtitle: 'Artist', image: null, savedAt: 1 }] } as never);
  });

  it('asks the catalogue for the newest page, newest first', async () => {
    latestAnswer = () => wrapper(raw('n1'));
    const out = await getArtistLatestSongs('459320');
    expect(requested).toEqual(['/artists/459320/songs?page=0&sortBy=latest&sortOrder=desc']);
    expect(out.sorted).toBe(true);
    expect(out.songs.map((x) => x.id)).toEqual(['n1']);
  });

  it('an answer without `total` ignored the sort, so it counts as the top list', async () => {
    latestAnswer = () => direct(raw('t1'));
    expect(await readArtist('ar1')).toMatchObject({ source: 'top', songs: [{ id: 't1' }] });
    expect(topSongs).not.toHaveBeenCalled();
  });

  it('when the newest list fails, it falls back to the top songs by popularity', async () => {
    latestAnswer = () => ({ success: false, data: null });
    topSongs.mockResolvedValue([song('t1')]);
    expect(await readArtist('ar1')).toMatchObject({ source: 'top', songs: [{ id: 't1' }] });
    expect(topSongs).toHaveBeenCalledWith('ar1', 0);
  });

  it('seeds on the first look, then a song released today shows on the next', async () => {
    latestAnswer = () => wrapper(raw('old1'), raw('old2', '2019'));
    expect(await checkReleases(true)).toBe(0);
    expect(ids()).toEqual([]);
    expect(useReleaseStore.getState().seeded).toEqual({ ar1: ['latest'] });

    latestAnswer = () => wrapper(raw('new1'), raw('old1'), raw('old2', '2019'));
    expect(await checkReleases(true)).toBe(1);
    expect(ids()).toEqual(['new1']);
    expect(useReleaseStore.getState().fresh[0].artist).toBe('Arijit Singh');

    // The same song again is not added twice.
    expect(await checkReleases(true)).toBe(0);
    expect(ids()).toEqual(['new1']);
    expect(topSongs).not.toHaveBeenCalled();
  });

  it('keeps the 12-hour gap unless forced', async () => {
    latestAnswer = () => wrapper(raw('old1'));
    await checkReleases(true);
    requested.length = 0;
    expect(await checkReleases()).toBe(0);
    expect(requested).toEqual([]);
  });

  it('a ledger from before 1.16 (top list only) is seeded by the newest list without a flood', async () => {
    useReleaseStore.setState({ seen: { ar1: ['top1'] }, seeded: undefined, fresh: [], checkedAt: 0 });
    expect(isSeeded(useReleaseStore.getState(), 'ar1', 'top')).toBe(true);
    expect(isSeeded(useReleaseStore.getState(), 'ar1', 'latest')).toBe(false);

    latestAnswer = () => wrapper(raw('back1'), raw('back2'), raw('top1'));
    expect(await checkReleases(true)).toBe(0);
    expect(useReleaseStore.getState().seeded).toEqual({ ar1: ['top', 'latest'] });
    expect(useReleaseStore.getState().seen.ar1).toEqual(['top1', 'back1', 'back2']);
  });

  it('a top list met for the first time after the newest list seeds quietly too', async () => {
    latestAnswer = () => wrapper(raw('new1'));
    await checkReleases(true);
    // Wrapper down: the Worker answers its top songs, which were never read before.
    latestAnswer = () => direct(raw('hit1'), raw('hit2'));
    expect(await checkReleases(true)).toBe(0);
    expect(useReleaseStore.getState().seeded).toEqual({ ar1: ['latest', 'top'] });
    // Once both lists have seeded, a song unseen in either is new from whichever list shows it.
    latestAnswer = () => direct(raw('hit3'), raw('hit1'));
    expect(await checkReleases(true)).toBe(1);
    expect(ids()).toEqual(['hit3']);
  });

  it('offline: nothing reached, so it tries again on the next open', async () => {
    latestAnswer = () => ({ success: false });
    topSongs.mockRejectedValue(new Error('offline'));
    expect(await checkReleases(true)).toBe(0);
    expect(useReleaseStore.getState().checkedAt).toBe(0);
  });
});
