// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KEYS } from '@/constants/storage-keys';
import { setLocal } from '@/services/storage/local';
import type { Song } from '@/types';

const api = vi.hoisted(() => ({ list: vi.fn(), write: vi.fn() }));
vi.mock('@/services/native', async (importOriginal) => ({ ...(await importOriginal<object>()), isNativePlatform: () => false }));
vi.mock('@/services/account/sync', () => ({ scheduleSync: vi.fn() }));
vi.mock('@/services/social/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listSharedPlaylists: api.list,
  writeSharedPlaylist: api.write,
}));
vi.mock('@/features/social/resolve', () => ({ resolveSongs: async (lite: Array<{ id: string }>) => lite.map((l) => song(l.id)) }));

import { SocialError, type SharedPlaylist } from '@/services/social/api';
import { useLibraryStore } from '@/store/libraryStore';
import { AUTO_PUSH_DELAY_MS, installSharedAutoPush, pushSharedCopy, sameAsCopy } from './sharedCopy';
import { inviteTokenFor, readShareMap, saveShareLink, shareLinkFor } from './shareMap';

function song(id: string): Song {
  return { kind: 'song', id, title: `Song ${id}`, subtitle: 'A', artists: [], album: null, images: [], audio: [], duration: 200, language: 'telugu', year: '2024', explicit: false, hasLyrics: false, playCount: null };
}
const ID = 'abcdefghij12';
const copy = (over: Partial<SharedPlaylist> = {}): SharedPlaylist => ({ id: ID, name: 'Road', description: null, songs: [{ id: 's1' }], public: true, collab: false, version: 3, owner: null, mine: true, createdAt: '', updatedAt: '', ...over });
const collection = () => useLibraryStore.getState().collections.find((c) => c.id === 'c1')!;

beforeEach(() => {
  localStorage.clear();
  setLocal(KEYS.account, { session: 'vx1.p.s', user: { name: 'A', email: 'a@x', picture: null, username: null } });
  useLibraryStore.setState({ collections: [{ id: 'c1', name: 'Road', createdAt: 1, songs: [song('s1')] }] });
  api.list.mockReset();
  api.write.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('pushSharedCopy', () => {
  it('creates the copy and remembers the link and the invite token apart', async () => {
    api.write.mockResolvedValue({ playlist: copy({ version: 1, collab: true, public: false }), collabToken: 'tok' });
    const r = await pushSharedCopy(collection(), { public: false, collab: true });
    expect(r.ok).toBe(true);
    expect(api.write.mock.calls[0][0]).toMatchObject({ id: undefined, name: 'Road', public: false, collab: true });
    expect(shareLinkFor('c1')).toMatchObject({ id: ID, version: 1, public: false });
    expect(inviteTokenFor(ID)).toBe('tok');
    expect(JSON.stringify(readShareMap())).not.toContain('tok');
  });

  it('on a 409 takes a collaborator’s songs in, then writes again with their version', async () => {
    saveShareLink('c1', { id: ID, version: 2 });
    api.list.mockResolvedValueOnce([copy({ version: 2 })]).mockResolvedValueOnce([copy({ version: 5, songs: [{ id: 's1' }, { id: 'f1', by: 'Ravi' }] })]);
    api.write.mockRejectedValueOnce(new SocialError(409, 'conflict')).mockResolvedValueOnce({ playlist: copy({ version: 6, songs: [{ id: 's1' }, { id: 'f1', by: 'Ravi' }] }) });
    const r = await pushSharedCopy(collection());
    expect(r).toMatchObject({ ok: true, merged: 1 });
    expect(api.write.mock.calls[1][0]).toMatchObject({ version: 5, songs: [{ id: 's1' }, { id: 'f1', by: 'Ravi' }] });
    expect(collection().songs.map((s) => s.id)).toEqual(['s1', 'f1']);
    expect(shareLinkFor('c1')?.version).toBe(6);
  });

  it('names the version it last wrote, so a friend’s newer songs are merged in and not written over', async () => {
    saveShareLink('c1', { id: ID, version: 2 });
    useLibraryStore.getState().addManyToCollection('c1', [song('s2')]);
    const theirs = copy({ version: 4, songs: [{ id: 's1' }, { id: 'f1', by: 'Ravi' }] });
    api.list.mockResolvedValue([theirs]);
    api.write.mockRejectedValueOnce(new SocialError(409, 'conflict')).mockResolvedValueOnce({ playlist: copy({ version: 5, songs: [{ id: 's1' }, { id: 's2' }, { id: 'f1', by: 'Ravi' }] }) });
    const r = await pushSharedCopy(collection(), { onlyIfChanged: true });
    expect(api.write.mock.calls[0][0]).toMatchObject({ version: 2 });
    expect(api.write.mock.calls[1][0]).toMatchObject({ version: 4, songs: [{ id: 's1' }, { id: 's2' }, { id: 'f1', by: 'Ravi' }] });
    expect(r).toMatchObject({ ok: true, merged: 1 });
    expect(collection().songs.map((s) => s.id)).toEqual(['s1', 's2', 'f1']);
  });

  it('skips the write when the copy already matches', async () => {
    saveShareLink('c1', { id: ID, version: 2 });
    api.list.mockResolvedValue([copy({ version: 4 })]);
    const r = await pushSharedCopy(collection(), { onlyIfChanged: true });
    expect(r).toMatchObject({ ok: true, wrote: false });
    expect(api.write).not.toHaveBeenCalled();
    expect(shareLinkFor('c1')?.version).toBe(4);
  });

  it('forgets the link when the copy is gone', async () => {
    saveShareLink('c1', { id: ID, version: 2 });
    api.list.mockResolvedValue([]);
    expect(await pushSharedCopy(collection())).toEqual({ ok: false, reason: 'gone' });
    expect(shareLinkFor('c1')).toBeNull();
  });

  it('compares name, description and song order', () => {
    expect(sameAsCopy({ name: 'Road', songs: [song('s1')] }, copy())).toBe(true);
    expect(sameAsCopy({ name: 'Road', description: 'new', songs: [song('s1')] }, copy())).toBe(false);
    expect(sameAsCopy({ name: 'Road', songs: [song('s2')] }, copy())).toBe(false);
  });
});

describe('auto-push', () => {
  it('pushes a shared playlist once, a few seconds after its last change', async () => {
    vi.useFakeTimers();
    saveShareLink('c1', { id: ID, version: 3 });
    api.list.mockResolvedValue([copy()]);
    api.write.mockResolvedValue({ playlist: copy({ version: 4, songs: [{ id: 's1' }, { id: 's2' }, { id: 's3' }] }) });
    const off = installSharedAutoPush();
    useLibraryStore.getState().addManyToCollection('c1', [song('s2')]);
    await vi.advanceTimersByTimeAsync(AUTO_PUSH_DELAY_MS - 1000);
    useLibraryStore.getState().addManyToCollection('c1', [song('s3')]);
    await vi.advanceTimersByTimeAsync(AUTO_PUSH_DELAY_MS - 1000);
    expect(api.write).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.write).toHaveBeenCalledTimes(1);
    expect((api.write.mock.calls[0][0] as { songs: Array<{ id: string }> }).songs.map((s) => s.id)).toEqual(['s1', 's2', 's3']);
    off();
  });

  it('leaves playlists without a share link alone', async () => {
    vi.useFakeTimers();
    const off = installSharedAutoPush();
    useLibraryStore.getState().addManyToCollection('c1', [song('s2')]);
    await vi.advanceTimersByTimeAsync(AUTO_PUSH_DELAY_MS * 2);
    expect(api.list).not.toHaveBeenCalled();
    expect(api.write).not.toHaveBeenCalled();
    off();
  });
});
