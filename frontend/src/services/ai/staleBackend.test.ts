// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';
import type { RecommendationContext } from '@/services/recommendation/types';

vi.mock('@/services/native', () => ({ isNativePlatform: () => false, platformName: () => 'web', haptic: () => undefined }));
vi.mock('@/services/personalization/session', () => ({ getMoodPin: () => null }));
vi.mock('@/services/api', () => ({ searchSongs: async () => [] }));

import { requestCurator, resetCuratorBackoff } from './recommendations';
import { djAvailable, djSequence, resetDjAvailability } from './dj';
import { createEmptyProfile } from '@/services/personalization/profile';

const song = (id: string): Song => ({
  kind: 'song', id, title: `T${id}`, subtitle: 'A', artists: [{ id: 'a', name: 'A' }], album: null, images: [], audio: [],
  duration: 200, language: 'telugu', year: '2020', explicit: false, hasLyrics: false, playCount: null,
});
const pool = [song('1'), song('2'), song('3'), song('4')];
const ctx = { profile: createEmptyProfile(1), history: [], favorites: [], pinnedLanguages: ['telugu'], mutedLanguages: [], intensity: 0.7, surface: 'next' } as unknown as RecommendationContext;

/**
 * v6.5.1 — a backend older than the app answers 404/405 for routes it does
 * not have. The clients must notice once and stay quiet, so a stale deploy
 * never adds a leash-long wait to every Home open or queue extension.
 */
beforeEach(() => { resetCuratorBackoff(); resetDjAvailability(); });
afterEach(() => vi.unstubAllGlobals());

describe('stale backend back-off', () => {
  it('curate: a 405 silences every task, including Home shelves, for ten minutes', async () => {
    const f = vi.fn(async () => new Response('Method Not Allowed', { status: 405 }));
    vi.stubGlobal('fetch', f);
    expect(await requestCurator('shelves', { taste: {} })).toBeNull();
    expect(await requestCurator('shelves', { taste: {} })).toBeNull();
    expect(await requestCurator('metadata', { songs: [] })).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('curate: an ordinary failure keeps Home shelves retrying (they are user-visible) but backs off the quiet tasks', async () => {
    const f = vi.fn(async () => new Response('{}', { status: 502 }));
    vi.stubGlobal('fetch', f);
    expect(await requestCurator('metadata', { songs: [] })).toBeNull();
    expect(await requestCurator('metadata', { songs: [] })).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
    expect(await requestCurator('shelves', { taste: {} })).toBeNull();
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('dj: a 405 disables the DJ for ten minutes without a 503-style permanent switch-off', async () => {
    const f = vi.fn(async () => new Response('Method Not Allowed', { status: 405 }));
    vi.stubGlobal('fetch', f);
    expect(await djSequence(pool[0], ctx, pool, 8)).toBeNull();
    expect(djAvailable()).toBe(false);
    expect(await djSequence(pool[0], ctx, pool, 8)).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
  });
});
