// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';
import { makeContext, makeSong } from '@/__fixtures__/songs';
import { createEmptyProfile } from '@/services/personalization/profile';

/**
 * 7.2 — candidate retrieval: one candidate per song with every source that
 * found it, bounded catalogue work (concurrency, identical requests, a short
 * response cache, soft and hard deadlines) and a cold start that uses what
 * the listener told us before any default.
 */
type Call = { fn: 'suggest' | 'search' | 'album'; key: string; signal?: AbortSignal };
let calls: Call[] = [];
let inFlight = 0;
let maxInFlight = 0;
/** Per-call behaviour: songs and a delay in ms (Infinity = never answers unless aborted). */
let respond: (call: Call) => { songs: Song[]; ms: number } = () => ({ songs: [], ms: 0 });

function fake(call: Call): Promise<Song[]> {
  calls.push(call);
  inFlight += 1;
  maxInFlight = Math.max(maxInFlight, inFlight);
  const { songs, ms } = respond(call);
  return new Promise<Song[]>((resolve, reject) => {
    const done = () => { inFlight -= 1; };
    const timer = Number.isFinite(ms) ? setTimeout(() => { done(); resolve(songs); }, ms) : undefined;
    call.signal?.addEventListener('abort', () => { if (timer) clearTimeout(timer); done(); reject(new Error('cancelled')); }, { once: true });
  });
}

vi.mock('@/services/api', () => ({
  getSongSuggestions: (id: string, limit: number) => fake({ fn: 'suggest', key: `${id}#${limit}` }),
  searchSongsPage: (q: string, page: number, limit: number, opts?: { signal?: AbortSignal }) => fake({ fn: 'search', key: `${q}#${page}#${limit}`, signal: opts?.signal }),
  getAlbum: (id: string) => fake({ fn: 'album', key: id }).then((songs) => ({ id, title: `Album ${id}`, songs })),
}));

import { gatherCandidates, generateNextCandidates, resetCandidateCache, CANDIDATE_FETCH_CONCURRENCY } from './candidates';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';

const NOW = 1_800_000_000_000;
const many = (prefix: string, n: number, over: Partial<Song> & { artist?: string } = {}) => Array.from({ length: n }, (_, i) => makeSong(`${prefix}${i}`, { artist: `${prefix} artist ${i}`, ...over }));
const searched = () => calls.filter((c) => c.fn === 'search').map((c) => c.key.split('#')[0]);

beforeEach(() => {
  calls = [];
  inFlight = 0;
  maxInFlight = 0;
  respond = () => ({ songs: [], ms: 0 });
  resetCandidateCache();
  localStorage.clear();
  useSettingsStore.setState({ kidMode: false, mutedLanguages: [] });
  useLibraryStore.setState({ hiddenSongIds: [], hiddenArtists: [] });
});

describe('provenance', () => {
  it('keeps ONE candidate per song, with every source and seed title, and intent as the primary', async () => {
    const seed = makeSong('seed', { title: 'Seed', artist: 'Sid Sriram' });
    const shared = makeSong('x', { artist: 'Anirudh' });
    respond = (c) => {
      if (c.fn === 'suggest') return { songs: [shared, makeSong('r1', { artist: 'R' })], ms: 1 };
      if (c.key.startsWith('telugu devotional')) return { songs: [shared], ms: 2 };
      if (c.key.startsWith('Sid Sriram')) return { songs: [shared, makeSong('a1', { artist: 'Sid Sriram' })], ms: 3 };
      return { songs: [], ms: 1 };
    };
    const out = await generateNextCandidates(seed, makeContext({ intentQuery: 'telugu devotional songs' }));
    const xs = out.filter((c) => c.song.id === 'x');
    expect(xs).toHaveLength(1);
    expect(xs[0].source).toBe('intent');
    expect(xs[0].sources).toEqual(['intent', 'related', 'favorite-artist']);
    expect(xs[0].seedTitles).toEqual(expect.arrayContaining(['Seed', 'telugu devotional songs', 'Sid Sriram']));
    expect(out.find((c) => c.song.id === 'r1')?.sources).toEqual(['related']);
  });
});

describe('bounded work', () => {
  const busyCtx = () => {
    const history = many('h', 6).map((song, i) => ({ song, ts: NOW - i * 60_000, completed: true }));
    const favorites = many('f', 5);
    const profile = createEmptyProfile(NOW);
    for (const [i, name] of ['A', 'B', 'C', 'D', 'E'].entries()) profile.artists[`id-${name}`] = { name, score: 10 - i, plays: 3, completes: 2, skips: 0, lastTs: NOW };
    profile.languages.telugu = { score: 20, plays: 20, completes: 10, skips: 1, lastTs: NOW };
    profile.languages.tamil = { score: 10, plays: 10, completes: 5, skips: 1, lastTs: NOW };
    return makeContext({ profile, history, favorites, pinnedLanguages: ['hindi'] });
  };

  it('never has more than a fixed number of catalogue requests in flight', async () => {
    respond = () => ({ songs: many('s', 3), ms: 15 });
    await gatherCandidates(busyCtx());
    expect(calls.length).toBeGreaterThan(CANDIDATE_FETCH_CONCURRENCY);
    expect(maxInFlight).toBeLessThanOrEqual(CANDIDATE_FETCH_CONCURRENCY);
  });

  it('makes one fetch for identical requests inside one gather (same endpoint, query and page)', async () => {
    const song = makeSong('both', { artist: 'Both' });
    // A favourite that is also a recent listen used to fetch its suggestions twice (12 and 10).
    respond = () => ({ songs: many('s', 3), ms: 1 });
    await gatherCandidates(makeContext({ favorites: [song], history: [{ song, ts: NOW, completed: true }] }));
    expect(calls.filter((c) => c.fn === 'suggest' && c.key.startsWith('both#'))).toHaveLength(1);
  });

  it('reuses a provider response for a short while, then fetches again', async () => {
    let clock = NOW;
    respond = () => ({ songs: many('s', 3), ms: 1 });
    const ctx = makeContext({ pinnedLanguages: ['telugu'] });
    await gatherCandidates(ctx, { now: () => clock });
    const first = calls.length;
    expect(first).toBeGreaterThan(0);
    await gatherCandidates(ctx, { now: () => clock });
    expect(calls.length).toBe(first); // served from the cache
    clock += 10 * 60_000;
    await gatherCandidates(ctx, { now: () => clock });
    expect(calls.length).toBe(first * 2); // expired: fetched again
  });

  it('stops waiting for slow optional sources once the pool is useful (soft deadline)', async () => {
    const seed = makeSong('seed', { title: 'Seed', artist: 'Slow Artist' });
    respond = (c) => (c.fn === 'suggest' ? { songs: many('rel', 30), ms: 2 } : c.key.startsWith('Slow Artist') ? { songs: many('slow', 5), ms: 1_500 } : { songs: [], ms: 1 });
    const report = vi.fn();
    const started = Date.now();
    const out = await generateNextCandidates(seed, makeContext(), { softDeadlineMs: 30, hardDeadlineMs: 1_000, minPool: 10, onReport: report });
    expect(Date.now() - started).toBeLessThan(700);
    expect(out.filter((c) => c.source === 'related')).toHaveLength(30);
    expect(out.some((c) => c.song.id.startsWith('slow'))).toBe(false);
    const r = report.mock.calls[0][0] as { settled: string[]; abandoned: string[]; ms: number };
    expect(r.abandoned).toEqual(expect.arrayContaining([expect.stringMatching(/^favorite-artist/)]));
    expect(r.settled).toEqual(expect.arrayContaining([expect.stringMatching(/^related/)]));
    // The abandoned search was cancelled, not left running.
    expect(calls.find((c) => c.key.startsWith('Slow Artist'))?.signal?.aborted).toBe(true);
  });

  it('keeps waiting past the soft deadline while the pool is too small, and gives up at the hard deadline', async () => {
    const seed = makeSong('seed', { title: 'Seed', artist: 'Stuck' });
    respond = (c) => (c.fn === 'suggest' ? { songs: many('rel', 3), ms: 2 } : { songs: many('late', 3), ms: Infinity });
    const report = vi.fn();
    const started = Date.now();
    const out = await generateNextCandidates(seed, makeContext(), { softDeadlineMs: 10, hardDeadlineMs: 80, minPool: 50, onReport: report });
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(70);
    expect(elapsed).toBeLessThan(700);
    expect(out.map((c) => c.song.id).sort()).toEqual(['rel0', 'rel1', 'rel2']);
    const searches = calls.filter((c) => c.fn === 'search');
    expect(searches.length).toBeGreaterThan(0);
    expect(searches.every((c) => c.signal?.aborted)).toBe(true);
    expect(report.mock.calls[0][0].abandoned.length).toBe(searches.length);
  });

  it('honours the caller’s abort signal', async () => {
    respond = () => ({ songs: many('s', 2), ms: Infinity });
    const controller = new AbortController();
    const pending = gatherCandidates(makeContext({ pinnedLanguages: ['telugu'] }), { signal: controller.signal, hardDeadlineMs: 5_000 });
    setTimeout(() => controller.abort(), 20);
    const started = Date.now();
    await expect(pending).resolves.toEqual([]);
    expect(Date.now() - started).toBeLessThan(700);
    expect(calls.every((c) => c.signal?.aborted)).toBe(true);
  });
});

describe('cold start', () => {
  it('uses pinned languages before any default', async () => {
    await gatherCandidates(makeContext({ pinnedLanguages: ['tamil'] }));
    expect(searched().some((q) => q.includes('tamil'))).toBe(true);
    expect(searched().some((q) => q.includes('hindi') || q.includes('english'))).toBe(false);
  });

  it('with an empty profile and nothing pinned, the languages of songs the listener liked (onboarding picks) come before the defaults', async () => {
    const favorites = [makeSong('f1', { artist: 'Sid Sriram', language: 'telugu' }), makeSong('f2', { artist: 'Chinmayi', language: 'telugu' })];
    await gatherCandidates(makeContext({ favorites }));
    expect(searched().some((q) => q.includes('telugu'))).toBe(true);
    expect(searched().some((q) => q.includes('hindi') || q.includes('english'))).toBe(false);
  });

  it('with no artist signal in the profile, the artists of liked songs seed the artist searches', async () => {
    const favorites = [makeSong('f1', { artist: 'Sid Sriram', language: 'telugu' }), makeSong('f2', { artist: 'Chinmayi', language: 'telugu' })];
    await gatherCandidates(makeContext({ favorites }));
    expect(searched()).toEqual(expect.arrayContaining(['Sid Sriram', 'Chinmayi']));
  });

  it('falls back to defaults only after all of that, and never to a muted default', async () => {
    await gatherCandidates(makeContext({ mutedLanguages: ['hindi'] }));
    const qs = searched();
    expect(qs.some((q) => q.includes('hindi'))).toBe(false);
    expect(qs.filter((q) => /english|tamil|telugu|punjabi/.test(q)).length).toBe(2);
  });
});

describe('safety at the source', () => {
  it('drops soft-muted artists, hidden songs and (in kid mode) explicit songs before anything else sees them', async () => {
    const profile = createEmptyProfile(NOW);
    profile.softMuted = { 'artist-muted-one': { until: Date.now() + 60_000 } };
    respond = () => ({ songs: [makeSong('m', { artist: 'Muted One' }), makeSong('e', { artist: 'E', explicit: true }), makeSong('hid', { artist: 'H' }), makeSong('ok', { artist: 'Fine' })], ms: 1 });
    useSettingsStore.setState({ kidMode: true });
    useLibraryStore.setState({ hiddenSongIds: ['hid'] });
    const out = await gatherCandidates(makeContext({ profile, pinnedLanguages: ['telugu'] }));
    expect(out.map((c) => c.song.id)).toEqual(['ok']);
  });
});
