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
type Call = { fn: 'suggest' | 'search' | 'album' | 'artist'; key: string; signal?: AbortSignal };
let calls: Call[] = [];
let inFlight = 0;
let maxInFlight = 0;
/** Per-call behaviour: songs and a delay in ms (Infinity = never answers unless aborted). */
let respond: (call: Call) => { songs: Song[]; ms: number } = () => ({ songs: [], ms: 0 });
/** 8.2.0 — the artist page call; rejects by default (the songs-only route answers instead). */
let artistPage: (id: string) => Promise<{ similarArtists?: { id: string; name: string }[]; topSongs?: Song[] }> = () => Promise.reject(new Error('no artist page'));

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
  getArtistTopSongs: (id: string) => fake({ fn: 'artist', key: id }),
  getArtist: (id: string) => artistPage(id),
}));

import { gatherCandidates, generateNextCandidates, resetCandidateCache, CANDIDATE_FETCH_CONCURRENCY } from './candidates';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { recordAutoOutcome, resetRecMemory } from './recMemory';
import { mergeCandidates } from './types';

const NOW = 1_800_000_000_000;
const many = (prefix: string, n: number, over: Partial<Song> & { artist?: string } = {}) => Array.from({ length: n }, (_, i) => makeSong(`${prefix}${i}`, { artist: `${prefix} artist ${i}`, ...over }));
const searched = () => calls.filter((c) => c.fn === 'search').map((c) => c.key.split('#')[0]);

beforeEach(() => {
  calls = [];
  inFlight = 0;
  maxInFlight = 0;
  respond = () => ({ songs: [], ms: 0 });
  resetCandidateCache();
  resetRecMemory();
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
    // 8.2.0 — plus the related-artist lookup: the artist catalogue call takes no signal, so it is abandoned, not cancelled.
    const abandoned = report.mock.calls[0][0].abandoned as string[];
    expect(abandoned.filter((l) => !l.startsWith('related-artist')).length).toBe(searches.length);
    expect(abandoned.filter((l) => l.startsWith('related-artist'))).toHaveLength(1);
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

describe('8.2 — sources around the seed', () => {
  const withAudio = (song: Song): Song => ({ ...song, audio: [{ quality: '160kbps', url: `https://cdn.test/${song.id}.mp4` }] });

  it('reads the seed’s own album', async () => {
    const seed = makeSong('seed', { title: 'Seed', artist: 'Sid Sriram', album: { id: 'alb', name: 'The Film' } });
    respond = (c) => (c.fn === 'album' && c.key === 'alb' ? { songs: [seed, makeSong('t2', { artist: 'Chinmayi' })], ms: 1 } : { songs: [], ms: 1 });
    const out = await generateNextCandidates(seed, makeContext());
    const t2 = out.find((c) => c.song.id === 't2');
    expect(t2?.source).toBe('album');
    expect(t2?.seedTitle).toBe('Seed');
  });

  it('reads artists who work with the seed’s artist: featured first, then collaborators, and caches who they are', async () => {
    const seed = makeSong('seed', { title: 'Seed', artist: 'Lead', artists: [{ id: 'lead', name: 'Lead' }, { id: 'feat', name: 'Feat' }] });
    const duet = (id: string, other: string) => makeSong(id, { artists: [{ id: 'lead', name: 'Lead' }, { id: other, name: other.toUpperCase() }] });
    respond = (c) => {
      if (c.fn !== 'artist') return { songs: [], ms: 1 };
      if (c.key === 'lead') return { songs: [duet('d1', 'c1'), duet('d2', 'c1'), duet('d3', 'c2')], ms: 1 };
      return { songs: Array.from({ length: 8 }, (_, i) => makeSong(`${c.key}-${i}`, { artist: c.key.toUpperCase() })), ms: 1 };
    };
    let clock = NOW;
    const out = await generateNextCandidates(seed, makeContext({ salt: 0 }), { now: () => clock });
    const artistCalls = calls.filter((c) => c.fn === 'artist').map((c) => c.key);
    expect(artistCalls).toEqual(['lead', 'feat', 'c1']);
    const related = out.filter((c) => c.source === 'related-artist');
    expect(related.map((c) => c.song.id)).toEqual([...Array.from({ length: 6 }, (_, i) => `feat-${i}`), ...Array.from({ length: 6 }, (_, i) => `c1-${i}`)]);
    expect(related[0].seedTitle).toBe('Lead');
    // Past the response cache, inside the collaborator cache: the lead artist's catalogue is not read again.
    calls = [];
    clock += 5 * 60_000;
    await generateNextCandidates(seed, makeContext({ salt: 0 }), { now: () => clock });
    expect(calls.filter((c) => c.fn === 'artist').map((c) => c.key)).toEqual(['feat', 'c1']);
  });

  it('prefers the catalogue’s similar artists over co-credits when the artist page lists them', async () => {
    const seed = makeSong('seed', { title: 'Seed', artist: 'Lead', artists: [{ id: 'lead', name: 'Lead' }] });
    const duet = makeSong('d1', { artists: [{ id: 'lead', name: 'Lead' }, { id: 'c1', name: 'C1' }] });
    artistPage = async (id) => (id === 'lead' ? { similarArtists: [{ id: 's1', name: 'S1' }, { id: 'lead', name: 'Lead' }], topSongs: [duet] } : {});
    respond = (c) => (c.fn === 'artist' ? { songs: Array.from({ length: 8 }, (_, i) => makeSong(`${c.key}-${i}`, { artist: c.key.toUpperCase() })), ms: 1 } : { songs: [], ms: 1 });
    try {
      const out = await generateNextCandidates(seed, makeContext({ salt: 0 }), { now: () => NOW });
      // The artist page answered, so the lead's songs-only route is never read; the similar artist leads, the co-credit follows.
      expect(calls.filter((c) => c.fn === 'artist').map((c) => c.key)).toEqual(['s1', 'c1']);
      expect(out.filter((c) => c.source === 'related-artist')[0].song.id).toBe('s1-0');
    } finally {
      artistPage = () => Promise.reject(new Error('no artist page'));
    }
  });

  it('searches the seed’s genre (or mood) in its language, once, and not when an intent is active', async () => {
    const seed = makeSong('seed', { title: 'Love Story', artist: 'Sid Sriram', genre: 'film' });
    await generateNextCandidates(seed, makeContext());
    expect(searched()).toContain('romantic telugu songs');
    calls = [];
    resetCandidateCache();
    await generateNextCandidates(seed, makeContext({ intentQuery: 'telugu devotional songs' }));
    expect(searched()).not.toContain('romantic telugu songs');
  });

  it('8.3 — asks the catalogue for the listener’s style in the seed’s language, rotating with the salt, and only in a style session', async () => {
    const seed = makeSong('seed', { title: 'Nadakallo Nadaka (DJ Remix Song)', artist: 'P.N. Lingaraju' });
    respond = (c) => (c.fn === 'search' && c.key.startsWith('telugu dj remix#') ? { songs: [makeSong('dj1', { title: 'Mama Nagulo (DJ Remix Song)', artist: 'Peddapuli Eeswar' })], ms: 1 } : { songs: [], ms: 1 });
    const out = await generateNextCandidates(seed, makeContext({ style: 'dj', salt: 0 }));
    expect(calls.filter((c) => c.fn === 'search').map((c) => c.key)).toEqual(expect.arrayContaining(['telugu dj remix#1#20', 'telugu remix songs#1#20']));
    expect(out.find((c) => c.song.id === 'dj1')).toMatchObject({ source: 'style', seedTitle: 'telugu dj remix' });
    // Another salt reaches other pages / the other phrasing first.
    calls = [];
    resetCandidateCache();
    await generateNextCandidates(makeSong('f', { title: 'Folk', language: 'tamil' }), makeContext({ style: 'folk', salt: 4 }));
    expect(calls.filter((c) => c.fn === 'search').map((c) => c.key)).toEqual(expect.arrayContaining(['tamil folk songs#2#20', 'tamil folk songs#3#20']));
    // No style: no style search.
    calls = [];
    resetCandidateCache();
    await generateNextCandidates(seed, makeContext());
    expect(searched().some((q) => /remix|folk songs/.test(q))).toBe(false);
    // Never in a muted language.
    calls = [];
    resetCandidateCache();
    await generateNextCandidates(seed, makeContext({ style: 'dj', mutedLanguages: ['telugu'] }));
    expect(searched().some((q) => /remix/.test(q))).toBe(false);
  });

  it('8.3.1 — under "Switch language" the style is searched in the language switched to, or not at all', async () => {
    const seed = makeSong('seed', { title: 'Nadakallo Nadaka (DJ Remix Song)', artist: 'P.N. Lingaraju', language: 'telugu' });
    await generateNextCandidates(seed, makeContext({ style: 'dj', styleLanguage: 'hindi', salt: 0 }));
    expect(searched()).toEqual(expect.arrayContaining(['hindi dj remix', 'hindi remix songs']));
    expect(searched().some((q) => q.startsWith('telugu') && /remix/.test(q))).toBe(false);
    calls = [];
    resetCandidateCache();
    await generateNextCandidates(seed, makeContext({ style: 'dj', styleLanguage: null }));
    expect(searched().some((q) => /remix/.test(q))).toBe(false);
  });

  it('offers songs like earlier automatic picks that worked, and a rested one itself', async () => {
    const proven = makeSong('p1', { title: 'Worked', artist: 'Past' });
    recordAutoOutcome(proven, 'success', NOW - 5 * 86_400_000);
    recordAutoOutcome(makeSong('m1', { artist: 'Missed' }), 'miss', NOW - 5 * 86_400_000);
    const seed = makeSong('seed', { title: 'Seed', artist: 'Sid Sriram' });
    respond = (c) => (c.fn === 'suggest' && c.key.startsWith('p1#') ? { songs: [makeSong('like-p1', { artist: 'Kin' })], ms: 1 } : { songs: [], ms: 1 });
    const out = await generateNextCandidates(seed, makeContext(), { now: () => NOW });
    expect(calls.some((c) => c.fn === 'suggest' && c.key.startsWith('m1#'))).toBe(false);
    expect(out.find((c) => c.song.id === 'like-p1')).toMatchObject({ source: 'proven', seedTitle: 'Worked' });
    expect(out.find((c) => c.song.id === 'p1')?.source).toBe('proven');
    // Not on Home: proven picks are a next-song source.
    calls = [];
    await gatherCandidates(makeContext(), { now: () => NOW });
    expect(calls.some((c) => c.key.startsWith('p1#'))).toBe(false);
  });

  it('marks a song with no stream URL as unplayable only when its response streamed other songs', async () => {
    const seed = makeSong('seed', { title: 'Seed', artist: 'Sid Sriram' });
    respond = (c) => {
      if (c.fn === 'suggest') return { songs: [withAudio(makeSong('ok', { artist: 'A' })), makeSong('mute', { artist: 'B' })], ms: 1 };
      if (c.fn === 'search' && c.key.startsWith('Sid Sriram')) return { songs: [makeSong('lazy', { artist: 'C' })], ms: 1 };
      return { songs: [], ms: 1 };
    };
    const out = await generateNextCandidates(seed, makeContext());
    expect(out.find((c) => c.song.id === 'ok')?.unplayable).toBeUndefined();
    expect(out.find((c) => c.song.id === 'mute')?.unplayable).toBe(true);
    expect(out.find((c) => c.song.id === 'lazy')?.unplayable).toBeUndefined();
  });

  it('keeps the copy that can stream when several sources found one song', () => {
    const bare = makeSong('x', { artist: 'A' });
    const merged = mergeCandidates([{ song: bare, source: 'trending', unplayable: true }, { song: withAudio(bare), source: 'related' }]);
    expect(merged).toHaveLength(1);
    expect(merged[0].song.audio).toHaveLength(1);
    expect(merged[0].unplayable).toBeUndefined();
    expect(mergeCandidates([{ song: bare, source: 'trending', unplayable: true }, { song: bare, source: 'related', unplayable: true }])[0].unplayable).toBe(true);
  });
});
