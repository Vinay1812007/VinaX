// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HistoryEntry, Song } from '@/types';
import type { RecommendationContext } from '@/services/recommendation/types';

vi.mock('@/services/native', () => ({ isNativePlatform: () => false, platformName: () => 'web', haptic: () => undefined }));
vi.mock('@/services/personalization/session', () => ({ getMoodPin: () => null }));
const searchMock = vi.fn(async (_q: string): Promise<Song[]> => []);
vi.mock('@/services/api', () => ({ searchSongs: (q: string) => searchMock(q) }));

import { buildDjContext, djAvailable, djSequence, matchesProposal, resetDjAvailability, resolveFromPool, resolvePicks, samplePool } from './dj';
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
  history: [{ song: pool[0], ts: 1, completed: true }, { song: pool[1], ts: 2, completed: false, skipped: true }, { song: pool[3], ts: 3, completed: false }] as HistoryEntry[],
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
    // v7.0.0 — only a flagged skip is a skip; the unfinished play (paused, or playing right now) is not.
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
      [{ title: 'butta bomma (from ala vaikunthapurramuloo)', artist: 'Armaan Malik, Others', reason: 'r1', segue: 's1', confidence: 0.8 }, { title: 'Made up', artist: 'X' }, { songId: '1', title: 'x', artist: 'y' }, { songId: 'nope', title: 'Butta Bomma', artist: 'Armaan Malik' }, { songId: 'ghost' }],
      pool,
      8,
    );
    expect(out.map((p) => p.song.id)).toEqual(['2', '1']);
    expect(out[0]).toMatchObject({ reason: 'r1', segue: 's1', confidence: 0.8 });
    expect(out[1].confidence).toBe(0.5);
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

describe('v6.5.0 — generative DJ, verified in the catalogue', () => {
  beforeEach(() => { searchMock.mockReset(); searchMock.mockResolvedValue([]); });

  it('matchesProposal accepts a real hit by identity or by title words + credited artist, never a loose first result', () => {
    expect(matchesProposal(song('9', 'Butta Bomma (From "Ala Vaikunthapurramuloo")', 'Armaan Malik'), 'Butta Bomma', 'Armaan Malik')).toBe(true);
    expect(matchesProposal(song('9', 'Butta Bomma', 'Armaan Malik, Thaman S'), 'butta bomma', 'Thaman')).toBe(true);
    expect(matchesProposal(song('9', 'Some Other Song', 'Armaan Malik'), 'Butta Bomma', 'Armaan Malik')).toBe(false);
    expect(matchesProposal(song('9', 'Butta Bomma', 'Someone Else'), 'Butta Bomma', 'Armaan Malik')).toBe(false);
    expect(matchesProposal(song('9', 'Butta Bomma (Dialogue)', 'Armaan Malik'), 'Butta Bomma', 'Armaan Malik')).toBe(false);
  });

  it('resolvePicks keeps pool picks in order and resolves off-pool proposals only through a matching, gated catalogue hit', async () => {
    const hit = song('n1', 'Ninnu Kori', 'Sid Sriram');
    const wrongLang = song('n2', 'Tum Hi Ho', 'Arijit Singh', { language: 'hindi' });
    searchMock.mockImplementation(async (q: string) => (q.startsWith('Ninnu Kori') ? [song('junk', 'Ninnu Kori Dialogue', 'Sid Sriram'), hit] : q.startsWith('Tum Hi Ho') ? [wrongLang] : [song('far', 'Unrelated', 'Nobody')]));
    const out = await resolvePicks(
      [
        { songId: '2', title: 'Butta Bomma', artist: 'Armaan Malik', reason: 'r' },
        { title: 'Ninnu Kori', artist: 'Sid Sriram', reason: 'discovery', segue: 'new one', confidence: 0.7 },
        { title: 'Tum Hi Ho', artist: 'Arijit Singh' },
        { title: 'Invented', artist: 'Nobody' },
        { songId: 'not-in-pool', title: 'Ghost', artist: 'X' },
        { title: 'Ramuloo Ramulaa', artist: 'Anurag Kulkarni' },
      ],
      pool,
      8,
      { language: 'telugu', admit: (s) => s.id !== 'blocked' },
    );
    expect(out.map((p) => p.song.id)).toEqual(['2', 'n1', '3']);
    expect(out[1]).toMatchObject({ discovered: true, reason: 'discovery', segue: 'new one', confidence: 0.7 });
    expect(out[0].discovered).toBeUndefined();
    // Proposals beyond the cap are never searched.
    expect(searchMock).toHaveBeenCalledTimes(4);
  });

  it('samplePool always keeps the top ranks and rotates the rest', () => {
    const big = Array.from({ length: 40 }, (_, i) => song(`s${i}`, `T${i}`, `A${i}`));
    const a = samplePool(big, 5, 12);
    expect(a).toHaveLength(12);
    expect(a.slice(0, 5).map((s) => s.id)).toEqual(['s0', 's1', 's2', 's3', 's4']);
    expect(new Set(a.map((s) => s.id)).size).toBe(12);
    expect(samplePool(big.slice(0, 6), 5, 12)).toHaveLength(6);
  });

  it('djSequence sends the discovery brief and the tune instruction, and accepts verified discoveries', async () => {
    searchMock.mockResolvedValue([song('n1', 'Ninnu Kori', 'Sid Sriram')]);
    const f = vi.fn(async () => new Response(JSON.stringify({ intro: 'Fresh.', songs: [{ songId: '3', title: 'Ramuloo Ramulaa', artist: 'Anurag Kulkarni' }, { title: 'Ninnu Kori', artist: 'Sid Sriram', fromPool: false, reason: 'a discovery' }, { songId: '4', title: 'Inkem Inkem', artist: 'Sid Sriram' }] }), { status: 200 }));
    vi.stubGlobal('fetch', f);
    const set = await djSequence(pool[0], ctx, pool, 8, undefined, { shape: 'steady', discover: true, tune: 'Shift the queue toward CALM songs.', gate: { language: 'telugu' } });
    const body = JSON.parse((f.mock.calls[0] as unknown as [string, { body: string }])[1].body) as { discover: boolean; maxDiscover: number; context: Record<string, unknown> };
    expect(body.discover).toBe(true);
    expect(body.maxDiscover).toBeGreaterThan(0);
    expect(body.context.tuneInstruction).toBe('Shift the queue toward CALM songs.');
    expect(typeof body.context.discoveryFocus).toBe('string');
    expect(set?.picks.map((p) => p.song.id)).toEqual(['3', 'n1', '4']);
    expect(set?.picks[1].discovered).toBe(true);
    expect(useReasonStore.getState().reasons.n1).toBe('a discovery');
  });
});
