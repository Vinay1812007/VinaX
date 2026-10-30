// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Candidate } from './types';
import { makeContext, makeSong, warmProfile } from '@/__fixtures__/songs';

/**
 * 7.2.0 — the next-song plan: built on the device inside one end-to-end
 * deadline, and no side effects until the caller commits what it accepted.
 */
let gather: () => Promise<Candidate[]> = async () => [];
vi.mock('./candidates', () => ({ gatherCandidates: vi.fn(() => gather()), generateNextCandidates: vi.fn(() => gather()) }));
vi.mock('@/services/queryClient', () => ({ queryClient: { getQueryData: () => undefined } }));

import { NEXT_URGENT_DEADLINE_MS, planNextSongs } from './engine';
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
  useSettingsStore.setState({ kidMode: false, mutedLanguages: [] });
  useLibraryStore.setState({ hiddenSongIds: [], hiddenArtists: [] });
  useReasonStore.setState({ reasons: {} });
});
afterEach(() => vi.useRealTimers());

describe('local first', () => {
  it('returns the validated order picked on the device', async () => {
    gather = async () => pool(12);
    const plan = await planNextSongs(seed, ctx(), { limit: 5 });
    expect(plan.songs).toHaveLength(5);
    expect(plan.picker).toBe('local');
  });

  it('a slow candidate source cannot hold the plan past its deadline', async () => {
    vi.useFakeTimers();
    gather = () => new Promise<Candidate[]>(() => undefined); // never settles
    const planned = planNextSongs(seed, ctx(), { limit: 5, deadlineMs: NEXT_URGENT_DEADLINE_MS });
    await vi.advanceTimersByTimeAsync(NEXT_URGENT_DEADLINE_MS + 50);
    const plan = await planned;
    expect(plan.fallback).toBe('deadline');
    expect(plan.songs).toEqual([]);
  });

  it('a cancelled plan returns nothing', async () => {
    gather = async () => pool(12);
    const ctrl = new AbortController();
    ctrl.abort();
    const plan = await planNextSongs(seed, ctx(), { limit: 5, signal: ctrl.signal });
    expect(plan.songs).toEqual([]);
  });
});

describe('side effects wait for the caller', () => {
  it('publishes nothing until commit, and only for the accepted songs', async () => {
    gather = async () => pool(12);
    const plan = await planNextSongs(seed, ctx(), { limit: 5 });
    expect(Object.keys(useReasonStore.getState().reasons)).toEqual([]);
    plan.commit(plan.songs.slice(0, 2));
    const published = Object.keys(useReasonStore.getState().reasons);
    expect(published.sort()).toEqual(plan.songs.slice(0, 2).map((s) => s.id).sort());
  });

  it('topUp re-validates the reserve against the song now at the end of the queue', async () => {
    gather = async () => pool(20);
    const plan = await planNextSongs(seed, ctx(), { limit: 5 });
    const last = plan.songs[plan.songs.length - 1];
    const more = plan.topUp(last, 3, { ids: new Set(plan.songs.map((s) => s.id)), keys: new Set() });
    expect(more.length).toBe(3);
    for (const s of more) expect(plan.songs.map((x) => x.id)).not.toContain(s.id);
    expect(more[0].artists[0].name).not.toBe(last.artists[0].name);
  });
});
