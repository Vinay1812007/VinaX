// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';
import type { PublicProfile } from '@/services/social/api';

const putMyProfile = vi.fn();
vi.mock('@/services/social/api', async (orig) => ({ ...(await orig<typeof import('@/services/social/api')>()), putMyProfile: (...a: unknown[]) => putMyProfile(...a) }));

import { SocialError } from '@/services/social/api';
import { KEYS } from '@/constants/storage-keys';
import { buildDigest, JAM_EVERY_MS, useSocialStore, withoutJams } from './store';

const song = (id: string): Song => ({ id, title: id, subtitle: 'A', images: [{ quality: '500x500', url: `u/${id}` }], language: 'telugu', year: '2020', duration: 200 } as unknown as Song);

describe('15.0 — the profile digest', () => {
  it('takes top artists, language shares and up to 20 recent likes, pared down', () => {
    const profile = {
      artists: { sid: { name: 'Sid Sriram', plays: 12, score: 5 }, arm: { name: 'Armaan', plays: 3, score: 1 } },
      languages: { telugu: { score: 3 }, hindi: { score: 1 }, unknown: { score: 9 } },
    } as never;
    const d = buildDigest(Array.from({ length: 25 }, (_, i) => song(`s${i}`)), profile);
    expect(d.topArtists[0]).toEqual({ name: 'Sid Sriram', plays: 12 });
    expect(d.topLanguages).toEqual([{ id: 'telugu', pct: 75 }, { id: 'hindi', pct: 25 }]);
    expect(d.recentLikes).toHaveLength(20);
    expect(d.recentLikes[0]).toEqual({ id: 's0', title: 's0', subtitle: 'A', image: 'u/s0', language: 'telugu', year: '2020', duration: 200 });
    expect('badges' in d).toBe(false);
  });
});

describe('v23 — the room goes with the profile only while sharing it', () => {
  const me = (over: Partial<PublicProfile> = {}): PublicProfile => ({ handle: 'asha', name: null, picture: null, bio: null, public: true, topArtists: [], topLanguages: [], recentLikes: [], badges: [], nowPlaying: null, updatedAt: new Date().toISOString(), shareJam: true, ...over });
  const jam = { code: 'JAM123', hostToken: 'tok' };
  beforeEach(() => {
    putMyProfile.mockReset();
    putMyProfile.mockImplementation(async () => me());
    useSocialStore.setState({ profile: me(), jamSent: null, jamAt: 0 });
  });
  afterEach(() => vi.useRealTimers());

  it('sends nothing without a profile or with the switch off', async () => {
    useSocialStore.setState({ profile: null });
    await useSocialStore.getState().pushJam(jam);
    useSocialStore.setState({ profile: me({ shareJam: false }) });
    await useSocialStore.getState().pushJam(jam);
    expect(putMyProfile).not.toHaveBeenCalled();
  });

  it('sends the room once, again only when due, and clears it when the session ends', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    await useSocialStore.getState().pushJam(jam);
    await useSocialStore.getState().pushJam(jam);
    expect(putMyProfile).toHaveBeenCalledTimes(1);
    expect(putMyProfile).toHaveBeenLastCalledWith({ jam });
    vi.setSystemTime(Date.now() + JAM_EVERY_MS + 1);
    await useSocialStore.getState().pushJam(jam);
    expect(putMyProfile).toHaveBeenCalledTimes(2);
    await useSocialStore.getState().pushJam(null);
    expect(putMyProfile).toHaveBeenLastCalledWith({ jam: null });
    expect(useSocialStore.getState().jamSent).toBeNull();
    // Nothing was sent: nothing to clear.
    await useSocialStore.getState().pushJam(null);
    expect(putMyProfile).toHaveBeenCalledTimes(3);
  });

  it('sends again when the bridge timer fires a little under the period after the last send', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    await useSocialStore.getState().pushJam(jam);
    vi.setSystemTime(Date.now() + JAM_EVERY_MS - 3_000);
    await useSocialStore.getState().pushJam(jam);
    expect(putMyProfile).toHaveBeenCalledTimes(2);
  });

  it('never keeps a friend\'s room code: not in storage, not from a stored copy', () => {
    const friend = me({ handle: 'bobo', jamCode: 'JAM123', shareJam: undefined });
    expect(withoutJams([friend])[0]).not.toHaveProperty('jamCode');
    expect(withoutJams([friend])[0]).toMatchObject({ handle: 'bobo' });
    expect(withoutJams('nope')).toEqual([]);
    useSocialStore.setState({ following: [friend] });
    const stored = JSON.parse(localStorage.getItem(KEYS.social) ?? '{}') as { state?: { following?: unknown[] } };
    expect(stored.state?.following?.[0]).not.toHaveProperty('jamCode');
  });

  it('a room the server calls over is not sent again straight away', async () => {
    putMyProfile.mockRejectedValue(new SocialError(409, 'ended'));
    await useSocialStore.getState().pushJam(jam);
    await useSocialStore.getState().pushJam(jam);
    expect(putMyProfile).toHaveBeenCalledTimes(1);
  });
});
