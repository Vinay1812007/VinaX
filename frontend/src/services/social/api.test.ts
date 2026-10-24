// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getFollowing, getMyProfile, getProfile, getSharedChat, getSharedPlaylist, listSharedPlaylists } from './api';

vi.mock('@/services/auth/google', () => ({ currentAccount: () => ({ session: 'vx1.t', user: {} }) }));

describe('15.0 — the social client never trusts an answer\'s shape', () => {
  const answer = (body: unknown, status = 200) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));
  beforeEach(() => answer({}));
  afterEach(() => vi.unstubAllGlobals());

  it('an empty {} becomes empty lists and nulls, never undefined', async () => {
    expect(await getFollowing()).toEqual([]);
    expect(await listSharedPlaylists()).toEqual([]);
    expect(await getMyProfile()).toBeNull();
    await expect(getProfile('bobo')).rejects.toMatchObject({ code: 'not_found' });
    await expect(getSharedPlaylist('abcdefghijkl')).rejects.toMatchObject({ code: 'not_found' });
    await expect(getSharedChat('abcdefghijkl')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('fills a partial profile in and drops malformed entries', async () => {
    answer({ following: [{ handle: 'bobo', nowPlaying: { id: 's1' } }, { nope: true }, null] });
    const list = await getFollowing();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ handle: 'bobo', topArtists: [], recentLikes: [], nowPlaying: { id: 's1' }, public: false });
  });
});
