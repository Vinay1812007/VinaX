// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HistoryEntry, Song } from '@/types';
import type { RecommendationContext } from '@/services/recommendation/types';

vi.mock('@/services/native', () => ({ isNativePlatform: () => false, platformName: () => 'web', haptic: () => undefined }));
vi.mock('@/services/personalization/session', () => ({ getMoodPin: () => null }));

import { buildDjContext, djAvailable, djSequence, resetDjAvailability, resolveFromPool } from './dj';
import { createEmptyProfile } from '@/services/personalization/profile';
import { useDjStore } from '@/store/djStore';
import { useReasonStore } from '@/store/reasonStore';

const song = (id: string, title: string, artist: string, extra: Partial<Song> = {}): Song => ({
  kind: 'song', id, title, subtitle: artist, artists: [{ id: `a-${artist}`, name: artist }], album: null, images: [], audio: [],
  duration: 200, language: 'telugu', year: '2020', explicit: false, hasLyrics: false, playCount: null, ...extra,
});
const pool = [song('1', 'Samajavaragamana', 'Sid Sriram'), song('2', 'Butta Bomma', 'Armaan Malik'), song('3', 'Ramuloo Ramulaa', 'Anurag Kulkarni'), song('4', 'Inkem Inkem', 'Sid Sriram')];
const profile = createEmptyProfile(1);
profile.artists.skipper = { name: 'Skipper', score: 1, plays: 5, completes: 0, skips: 5, lastTs: 1 };
const ctx = {
  profile,
  history: [{ song: pool[0], ts: 1, completed: true }, { song: pool[1], ts: 2, completed: false }] as HistoryEntry[],
  favorites: [pool[2]],
  pinnedLanguages: ['telugu'],
  mutedLanguages: ['english'],
  intensity: 0.7,
  surface: 'next',
} as unknown as RecommendationContext;

beforeEach(() => {
  localStorage.clear();
  resetDjAvailability();
  useDjStore.getState().clear();
  useReasonStore.setState({ reasons: {} });
});
afterEach(() => vi.unstubAllGlobals());

describe('buildDjContext', () => {
  it('sends titles and artists only, never song ids, and carries the taste signals', () => {
    const c = buildDjContext(pool[0], ctx);
    expect(c.seedSong).toBe('Samajavaragamana — Sid Sriram (telugu)');
    expect(c.currentLanguage).toBe('telugu');
    expect(c.recentlyCompleted).toEqual(['Samajavaragamana — Sid Sriram (telugu)']);
    expect(c.skippedSongs).toEqual(['Butta Bomma — Armaan Malik (telugu)']);
    expect(c.likedSongs).toEqual(['Ramuloo Ramulaa — Anurag Kulkarni (telugu)']);
    expect(c.avoidArtists).toEqual(['Skipper']);
    expect(c.avoidLanguages).toEqual(['english']);
    expect(JSON.stringify(c)).not.toMatch(/"id"/);
  });
});

describe('resolveFromPool', () => {
  it('maps picks back by canonical identity and drops anything not in the pool', () => {
    const out = resolveFromPool(
      [{ title: 'butta bomma (from ala vaikunthapurramuloo)', artist: 'Armaan Malik, Others', reason: 'r1', segue: 's1' }, { title: 'Made up', artist: 'X' }, { title: 'Samajavaragamana', artist: 'Sid Sriram' }, { title: 'Butta Bomma', artist: 'Armaan Malik' }],
      pool,
      8,
    );
    expect(out.map((p) => p.song.id)).toEqual(['2', '1']);
    expect(out[0]).toMatchObject({ reason: 'r1', segue: 's1' });
  });
});

describe('djSequence', () => {
  it('returns the DJ order, publishes reasons and segues, and remembers what it surfaced', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ intro: 'Easing in.', songs: [{ title: 'Ramuloo Ramulaa', artist: 'Anurag Kulkarni', reason: 'folk lift', segue: 'Here comes a folk lift' }, { title: 'Inkem Inkem', artist: 'Sid Sriram', reason: 'soft', segue: 'Softly now' }, { title: 'Butta Bomma', artist: 'Armaan Malik', reason: 'peak', segue: 'And the peak' }] }), { status: 200 })));
    const set = await djSequence(pool[0], ctx, pool, 8);
    expect(set?.intro).toBe('Easing in.');
    expect(set?.picks.map((p) => p.song.id)).toEqual(['3', '4', '2']);
    expect(useReasonStore.getState().reasons['3']).toBe('folk lift');
    expect(useDjStore.getState().segues['4']).toBe('Softly now');
    expect(useDjStore.getState().intro).toBe('Easing in.');
    const surfaced = JSON.parse(localStorage.getItem('vinax.dj.surfaced.v1') ?? '[]') as Array<{ id: string }>;
    expect(surfaced.map((s) => s.id)).toEqual(['3', '4', '2']);
    // The next round tells the DJ to avoid them.
    expect(buildDjContext(pool[0], ctx).avoidSongs).toHaveLength(3);
  });

  it('gives up cleanly: 503 disables the DJ for the session, errors back off, thin answers are ignored', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
    expect(await djSequence(pool[0], ctx, pool, 8)).toBeNull();
    expect(djAvailable()).toBe(false);
    resetDjAvailability();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
    expect(await djSequence(pool[0], ctx, pool, 8)).toBeNull();
    expect(djAvailable()).toBe(false);
    resetDjAvailability();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ songs: [{ title: 'Butta Bomma', artist: 'Armaan Malik' }] }), { status: 200 })));
    expect(await djSequence(pool[0], ctx, pool, 8)).toBeNull();
    expect(djAvailable()).toBe(true);
  });

  it('never calls the network for a pool that is too small', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    expect(await djSequence(pool[0], ctx, pool.slice(0, 2), 8)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
});
