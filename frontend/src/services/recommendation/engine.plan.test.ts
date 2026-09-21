// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';
import type { Candidate } from './types';
import { makeContext, makeSong, warmProfile } from '@/__fixtures__/songs';

/**
 * 7.2.0 — the next-song plan: local first inside one end-to-end deadline, the
 * AI DJ as a bounded refinement, and no side effects until the caller commits
 * what it accepted.
 */
let gather: () => Promise<Candidate[]> = async () => [];
const djSequence = vi.fn();
const commitDjSet = vi.fn();
let djOutcome = 'ok';
vi.mock('./candidates', () => ({ gatherCandidates: vi.fn(() => gather()), generateNextCandidates: vi.fn(() => gather()) }));
vi.mock('@/services/ai/recommendations', () => ({ enrichSongs: vi.fn(async (songs: Song[]) => songs), aiRerankSongs: vi.fn(async (songs: Song[]) => songs) }));
vi.mock('@/services/ai/dj', () => ({ djSequence: (...a: unknown[]) => djSequence(...a), samplePool: (songs: Song[]) => songs, commitDjSet: (...a: unknown[]) => commitDjSet(...a), lastDjOutcome: () => djOutcome }));
vi.mock('@/services/queryClient', () => ({ queryClient: { getQueryData: () => undefined } }));

import { NEXT_URGENT_DEADLINE_MS, planNextSongs, recommendNextSongs } from './engine';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useReasonStore } from '@/store/reasonStore';
import { resetTransitionMemory } from './transitions';

const NOW = 1_800_000_000_000;
const seed = makeSong('seed', { title: 'Seed', artist: 'Sid Sriram' });
const pool = (n: number): Candidate[] => Array.from({ length: n }, (_, i) => ({ song: makeSong(`te${i}`, { artist: `Artist ${i}`, playCount: 5_000_000 - i * 1000 }), source: 'related' as const }));
const ctx = () => makeContext({ profile: warmProfile(NOW), pinnedLanguages: ['telugu'], surface: 'next' });

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetTransitionMemory();
  djSequence.mockReset();
  commitDjSet.mockReset();
  djOutcome = 'ok';
  useSettingsStore.setState({ aiDj: true, kidMode: false, mutedLanguages: [] });
  useLibraryStore.setState({ hiddenSongIds: [], hiddenArtists: [] });
  useReasonStore.setState({ reasons: {} });
});
afterEach(() => vi.useRealTimers());

describe('local first', () => {
  it('returns the validated local order without waiting for a slow DJ; the DJ is a refinement', async () => {
    const p = pool(12);
    gather = async () => p;
    let answer: (v: unknown) => void = () => undefined;
    djSequence.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    const plan = await planNextSongs(seed, ctx(), { limit: 5 });
    expect(plan.songs).toHaveLength(5);
    expect(plan.picker).toBe('local');
    expect(plan.refinement).not.toBeNull();
    const pick = (song: Song) => ({ song, reason: `because ${song.id}`, segue: '', confidence: 0.8 });
    answer({ intro: 'hi', picks: [pick(p[3].song), pick(p[1].song), pick(p[0].song), pick(p[2].song), pick(p[4].song)] });
    const refined = await plan.refinement;
    expect(refined && 'songs' in refined ? refined.picker : 'none').toBe('ai');
  });

  it('a slow candidate source cannot hold the plan past its deadline', async () => {
    vi.useFakeTimers();
    gather = () => new Promise<Candidate[]>(() => undefined); // never settles
    useSettingsStore.setState({ aiDj: false });
    const planned = planNextSongs(seed, ctx(), { limit: 5, deadlineMs: NEXT_URGENT_DEADLINE_MS });
    await vi.advanceTimersByTimeAsync(NEXT_URGENT_DEADLINE_MS + 50);
    const plan = await planned;
    expect(plan.fallback).toBe('deadline');
    expect(plan.songs).toEqual([]);
  });

  it('a cancelled plan returns nothing and asks the DJ nothing', async () => {
    gather = async () => pool(12);
    const ctrl = new AbortController();
    ctrl.abort();
    const plan = await planNextSongs(seed, ctx(), { limit: 5, signal: ctrl.signal });
    expect(plan.songs).toEqual([]);
    expect(djSequence).not.toHaveBeenCalled();
  });

  it('reports why the AI did not choose the order', async () => {
    gather = async () => pool(12);
    djOutcome = 'timeout';
    djSequence.mockResolvedValueOnce(null);
    const plan = await planNextSongs(seed, ctx(), { limit: 5 });
    expect(await plan.refinement).toEqual({ rejected: 'ai_timeout' });
  });
});

describe('side effects wait for the caller', () => {
  it('publishes nothing until commit, and only for the accepted songs', async () => {
    gather = async () => pool(12);
    useSettingsStore.setState({ aiDj: false });
    const plan = await planNextSongs(seed, ctx(), { limit: 5 });
    expect(Object.keys(useReasonStore.getState().reasons)).toEqual([]);
    plan.commit(plan.songs.slice(0, 2));
    const published = Object.keys(useReasonStore.getState().reasons);
    expect(published.sort()).toEqual(plan.songs.slice(0, 2).map((s) => s.id).sort());
  });

  it('a DJ proposal that fails validation is never committed', async () => {
    const p = pool(12);
    gather = async () => p;
    const outsider = makeSong('hi-x', { artist: 'H', language: 'hindi' });
    djSequence.mockResolvedValueOnce({ intro: 'x', picks: [outsider, makeSong('hi-y', { artist: 'I', language: 'hindi' }), makeSong('hi-z', { artist: 'J', language: 'hindi' })].map((song) => ({ song, reason: 'r', segue: 's', confidence: 1, discovered: true })) });
    const out = await recommendNextSongs(seed, ctx(), { limit: 5 });
    expect(out.map((s) => s.id)).not.toContain('hi-x');
    // The refinement was rejected (off-language), so the DJ set was never committed.
    expect(commitDjSet).not.toHaveBeenCalled();
  });

  it('topUp re-validates the reserve against the song now at the end of the queue', async () => {
    gather = async () => pool(20);
    useSettingsStore.setState({ aiDj: false });
    const plan = await planNextSongs(seed, ctx(), { limit: 5 });
    const last = plan.songs[plan.songs.length - 1];
    const more = plan.topUp(last, 3, { ids: new Set(plan.songs.map((s) => s.id)), keys: new Set() });
    expect(more.length).toBe(3);
    for (const s of more) expect(plan.songs.map((x) => x.id)).not.toContain(s.id);
    expect(more[0].artists[0].name).not.toBe(last.artists[0].name);
  });
});

describe('the listener\'s master switch for AI in recommendations', () => {
  it('off: the plan asks no AI — no DJ, no re-rank — and the local order ships', async () => {
    const { aiRerankSongs } = await import('@/services/ai/recommendations');
    vi.mocked(aiRerankSongs).mockClear();
    gather = async () => pool(12);
    useSettingsStore.setState({ aiAssist: false, aiDj: true });
    const plan = await planNextSongs(seed, ctx(), { limit: 5 });
    expect(plan.songs).toHaveLength(5);
    expect(plan.refinement).toBeNull();
    expect(djSequence).not.toHaveBeenCalled();
    expect(aiRerankSongs).not.toHaveBeenCalled();
    useSettingsStore.setState({ aiAssist: true });
  });
});
