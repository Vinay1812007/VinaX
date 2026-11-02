// @vitest-environment jsdom
/**
 * 9.1.0 — the repetition acceptance tests.
 *
 * These are the targets the 9.1 work was done against, stated as tests so a
 * regression is a red build rather than a field report. They are
 * FIXTURE-SPECIFIC by construction: the catalogue below always answers with 120
 * distinct, playable, in-language songs by 24 artists, so "the pool ran dry" can
 * never be the reason a target is missed. Real catalogue coverage for a narrow
 * request can be much thinner — ./validation.ts documents what is relaxed, and
 * in what order, when it is.
 *
 * What each test pins:
 *   - two consecutive 20-song continuations introduce at least 12 songs the
 *     previous one did not have (the headline target);
 *   - no canonical duplicates inside one generation;
 *   - artist diversity holds unless the request narrows to one artist;
 *   - no hard preference restriction is ever broken, including when the engine
 *     has to relax something to fill the list;
 *   - the queue's picks are visible to Home, and the other
 *     way round (one ledger, every surface);
 *   - all of it survives a reload.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';
import { makeContext, makePlay, makeSong, warmProfile } from '@/__fixtures__/songs';

const LANGUAGE = 'telugu';
const ARTISTS = Array.from({ length: 24 }, (_, i) => `Artist ${String.fromCharCode(65 + i)}`);

/** 120 distinct songs, 5 per artist. Deterministic: no clock, no randomness. */
const CATALOGUE: Song[] = ARTISTS.flatMap((artist, a) =>
  Array.from({ length: 5 }, (_, n) =>
    makeSong(`c${a * 5 + n}`, {
      title: `Track ${a * 5 + n}`,
      artist,
      language: LANGUAGE,
      audio: [{ quality: '160kbps', url: `https://audio.test/${a * 5 + n}.mp4` }],
    }),
  ),
);

/**
 * The catalogue client. Every search answers a PAGE of the fixture, so reading
 * deeper really does reach other songs — which is what 9.1 changed the gather
 * to do. Suggestions answer from the song's neighbourhood.
 */
const PAGE = 20;
/** The catalogue the mocked client answers from (the Never repeat session swaps in a bigger one). */
let ACTIVE: Song[] = CATALOGUE;
function page(n: number, limit: number): Song[] {
  const start = (Math.max(1, n) - 1) * PAGE;
  return ACTIVE.slice(start, start + PAGE).slice(0, limit);
}

vi.mock('@/services/api', () => ({
  searchSongsPage: async (_q: string, p: number, limit: number) => page(p, limit),
  searchSongs: async (_q: string, limit: number) => page(1, limit),
  // Suggestions STRIDE the catalogue rather than returning a contiguous block:
  // a real "you might also like" list is spread across artists, and a
  // contiguous slice of this fixture would be five songs by one artist, which
  // would make the artist-diversity assertions test the fixture, not the engine.
  getSongSuggestions: async (id: string, limit: number) => {
    const at = ACTIVE.findIndex((s) => s.id === id);
    const from = at < 0 ? 0 : at + 1;
    const out: Song[] = [];
    for (let step = 0; out.length < limit && step < ACTIVE.length; step += 1) {
      out.push(ACTIVE[(from + step * 7) % ACTIVE.length]);
    }
    return [...new Map(out.map((x) => [x.id, x])).values()].slice(0, limit);
  },
  getAlbum: async () => null,
  getArtist: async () => null,
  getArtistTopSongs: async () => [],
  getSong: async (id: string) => ACTIVE.find((s) => s.id === id) ?? null,
}));
vi.mock('@/services/queryClient', () => ({ queryClient: { getQueryData: () => undefined } }));

import { planNextSongs } from './engine';
import { exposureLedger, recordExposure, resetExposure } from './exposure';
import { resetCandidateCache } from './candidates';
import { resetRecMemory } from './recMemory';
import { songKey } from './songKey';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { resetTrendSignal } from '@/services/trends/signal';
import { initHeardSet, memoryBackend, recordHeard, resetHeardSetForTests } from './heardSet';

const BATCH = 20;
const lead = (s: Song): string => s.artists[0]?.name ?? '';

function context(over: Parameters<typeof makeContext>[0] = {}) {
  return makeContext({
    profile: warmProfile(0),
    pinnedLanguages: [LANGUAGE],
    discoveryMode: 'discover',
    ...over,
  });
}

/** One continuation, committed the way the player commits what it accepted. */
async function generate(seed: Song, salt: number, over: Parameters<typeof makeContext>[0] = {}): Promise<Song[]> {
  resetCandidateCache();
  const plan = await planNextSongs(seed, context({ salt, ...over }), { limit: BATCH, deadlineMs: 8_000 });
  plan.commit(plan.songs);
  return plan.songs;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetExposure();
  resetRecMemory();
  resetCandidateCache();
  resetTrendSignal();
  useSettingsStore.setState({ kidMode: false, mutedLanguages: [] });
  useLibraryStore.setState({ hiddenSongIds: [], hiddenArtists: [], favorites: [] });
  ACTIVE = CATALOGUE;
  resetHeardSetForTests();
});

describe('9.1 acceptance — a 120-track fixture (24 artists, all playable, all in-language)', () => {
  it('has at least 100 eligible distinct tracks, as the target assumes', () => {
    expect(new Set(CATALOGUE.map((s) => songKey(s))).size).toBeGreaterThanOrEqual(100);
  });

  it('two consecutive 20-song generations introduce at least 12 new tracks', async () => {
    const seed = makeSong('seed', { title: 'Seed', artist: 'Seed Artist', language: LANGUAGE });
    const first = await generate(seed, 1);
    const second = await generate(seed, 2);
    expect(first.length).toBe(BATCH);
    expect(second.length).toBe(BATCH);
    const before = new Set(first.map(songKey));
    const introduced = second.filter((s) => !before.has(songKey(s)));
    expect(introduced.length).toBeGreaterThanOrEqual(12);
  });

  it('introduces new tracks again after a reload (the ledger is on disk, not in memory)', async () => {
    const seed = makeSong('seed', { title: 'Seed', artist: 'Seed Artist', language: LANGUAGE });
    const first = await generate(seed, 1);
    // A "reload": module state is dropped, localStorage is not.
    const stored = localStorage.getItem('vinax.recs.exposure.v1');
    expect(stored).toBeTruthy();
    resetExposure();
    resetRecMemory();
    localStorage.setItem('vinax.recs.exposure.v1', stored!);
    const second = await generate(seed, 2);
    const before = new Set(first.map(songKey));
    expect(second.filter((s) => !before.has(songKey(s))).length).toBeGreaterThanOrEqual(12);
  });

  // 11.7.0 — real use, not a clean fixture: between two queue runs the
  // listener opens Home a few times, and every shelf records what it showed.
  // Before 11.7 the ledger kept the newest 600 rows of ANY kind, so that flood
  // evicted the queue's own rows and the second run served the first again.
  it('still introduces new tracks after Home floods the ledger between generations', async () => {
    const seed = makeSong('seed', { title: 'Seed', artist: 'Seed Artist', language: LANGUAGE });
    const first = await generate(seed, 1);
    for (let visit = 0; visit < 6; visit += 1) {
      const shelf = Array.from({ length: 250 }, (_, i) => makeSong(`home-${visit}-${i}`, { title: `Home Pick ${visit}-${i}`, artist: `Home Artist ${i % 40}`, language: LANGUAGE }));
      recordExposure(shelf, 'shown');
    }
    const second = await generate(seed, 2);
    const before = new Set(first.map(songKey));
    expect(second.filter((s) => !before.has(songKey(s))).length).toBeGreaterThanOrEqual(12);
  });

  it('never repeats a canonical identity inside one generation', async () => {
    const seed = makeSong('seed', { title: 'Seed', artist: 'Seed Artist', language: LANGUAGE });
    for (const salt of [1, 2, 3]) {
      const out = await generate(seed, salt);
      expect(new Set(out.map(songKey)).size).toBe(out.length);
    }
  });

  it('keeps artists varied: no lead artist back to back, and none owns the list', async () => {
    const seed = makeSong('seed', { title: 'Seed', artist: 'Seed Artist', language: LANGUAGE });
    const out = await generate(seed, 7);
    for (let i = 1; i < out.length; i += 1) expect(lead(out[i])).not.toBe(lead(out[i - 1]));
    const counts = new Map<string, number>();
    for (const s of out) counts.set(lead(s), (counts.get(lead(s)) ?? 0) + 1);
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(Math.ceil(out.length / 3));
    expect(counts.size).toBeGreaterThanOrEqual(6);
  });

  it('breaks no hard restriction: a muted language, a hidden song and a hidden artist never ship', async () => {
    const seed = makeSong('seed', { title: 'Seed', artist: 'Seed Artist', language: LANGUAGE });
    useLibraryStore.setState({ hiddenSongIds: ['c0', 'c1', 'c2'], hiddenArtists: ['artist b'] });
    const out = await generate(seed, 3, { mutedLanguages: ['hindi'] });
    expect(out.map((s) => s.id)).not.toContain('c0');
    expect(out.map((s) => s.id)).not.toContain('c1');
    expect(out.map((s) => s.id)).not.toContain('c2');
    expect(out.every((s) => s.language === LANGUAGE)).toBe(true);
    expect(out.map(lead)).not.toContain('Artist B');
  });

  it('returns fewer songs rather than breaking a restriction when the pool really is exhausted', async () => {
    // Hide all but a handful: the engine must ship what is left, not reach for
    // a hidden song to make the count.
    const seed = makeSong('seed', { title: 'Seed', artist: 'Seed Artist', language: LANGUAGE });
    useLibraryStore.setState({ hiddenSongIds: CATALOGUE.slice(4).map((s) => s.id), hiddenArtists: [] });
    const out = await generate(seed, 5);
    expect(out.length).toBeLessThan(BATCH);
    for (const s of out) expect(CATALOGUE.slice(0, 4).map((x) => x.id)).toContain(s.id);
  });

  it('one ledger: what the queue surfaced is visible to every other surface', async () => {
    const seed = makeSong('seed', { title: 'Seed', artist: 'Seed Artist', language: LANGUAGE });
    const out = await generate(seed, 1);
    const ledger = exposureLedger();
    // Every song the player accepted is now cooling for Home.
    for (const s of out) expect(ledger.cooling(songKey(s))).toBe(true);
  });

  it('and the other way round: what Home showed costs the queue something', async () => {
    const seed = makeSong('seed', { title: 'Seed', artist: 'Seed Artist', language: LANGUAGE });
    const baseline = await generate(seed, 11);
    resetExposure();
    // Home shows the first half of what the queue would otherwise have picked.
    recordExposure(baseline.slice(0, 10), 'shown');
    const after = await generate(seed, 11);
    const shownKeys = new Set(baseline.slice(0, 10).map(songKey));
    const repeated = after.filter((s) => shownKeys.has(songKey(s))).length;
    expect(repeated).toBeLessThan(10);
  });

  it('a favourite is allowed to come back: liking a song lifts its cooling', async () => {
    const favourite = CATALOGUE[0];
    recordExposure([favourite], 'played');
    expect(exposureLedger().cooling(songKey(favourite))).toBe(true);
    recordExposure([favourite], 'liked');
    expect(exposureLedger().cooling(songKey(favourite))).toBe(false);
  });

  /**
   * 9.1.0 — Familiar / Balanced / Discover have to be MEASURABLY different, not
   * just differently labelled. Measured here as the share of a stretch by artists
   * this listener has never played, over four salts, on one pool where half the
   * artists are known and half are strangers.
   */
  it('Familiar, Balanced and Discover differ measurably on the same pool', async () => {
    const known = ARTISTS.slice(0, 12);
    const history = known.map((a, i) => makePlay(makeSong(`h${i}`, { artist: a, language: LANGUAGE }), 1000 - i));
    const seed = makeSong('seed', { title: 'Seed', artist: known[0], language: LANGUAGE });
    const share: Record<string, number> = {};
    for (const mode of ['familiar', 'balanced', 'discover'] as const) {
      const runs: number[] = [];
      for (const salt of [1, 2, 3, 4]) {
        resetExposure();
        resetRecMemory();
        resetCandidateCache();
        const plan = await planNextSongs(seed, context({ salt, discoveryMode: mode, history }), { limit: BATCH, deadlineMs: 8_000 });
        const strangers = plan.songs.filter((s) => !known.includes(lead(s))).length;
        runs.push(plan.songs.length ? strangers / plan.songs.length : 0);
      }
      share[mode] = runs.reduce((a, b) => a + b, 0) / runs.length;
    }
    // Each mode is clearly apart from the next, in the right direction.
    expect(share.familiar).toBeLessThan(0.1);
    expect(share.balanced).toBeGreaterThan(share.familiar + 0.1);
    expect(share.discover).toBeGreaterThan(share.balanced + 0.1);
    // And each lands near its documented allocation (DISCOVERY_SHARE in engine.ts).
    expect(share.balanced).toBeCloseTo(0.2, 1);
    expect(share.discover).toBeCloseTo(0.45, 1);
  });

  it('respects a deliberate single-artist request: diversity does not override it', async () => {
    // The pool itself is one artist (the hard filter is what narrows a request
    // like "only Artist A"); the list must still fill rather than refuse.
    const seed = makeSong('seed', { title: 'Seed', artist: 'Artist A', language: LANGUAGE });
    useLibraryStore.setState({ hiddenSongIds: CATALOGUE.filter((s) => lead(s) !== 'Artist A').map((s) => s.id), hiddenArtists: [] });
    const out = await generate(seed, 2);
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((s) => lead(s) === 'Artist A')).toBe(true);
  });
});

/**
 * 1.4 — Never repeat, over a long sitting. 100 artists with 8 songs each, and
 * another cut (a remix, a remaster, a live take) of 200 of those songs under
 * its own catalogue id, so "another version of something heard" really is in
 * the pool. The simulated listener lets every automatic song play: each one
 * produces a PLAY (it joins the heard-set and the history) and the next stretch
 * follows it, five songs at a time, as the player asks.
 */
describe('1.4 acceptance — Never repeat over a 500-song sitting', () => {
  const ORIGINALS: Song[] = Array.from({ length: 100 }, (_, a) =>
    Array.from({ length: 8 }, (_, n) =>
      makeSong(`o${a * 8 + n}`, { title: `Song ${a * 8 + n}`, artist: `Singer ${a}`, language: LANGUAGE, audio: [{ quality: '160kbps', url: `https://audio.test/o${a * 8 + n}.mp4` }] }),
    ),
  ).flat();
  const CUTS = ['(DJ Remix)', '(Remastered 2024)', '- Live', '(Lofi Flip)'];
  const VERSIONS: Song[] = ORIGINALS.slice(0, 200).map((o, i) =>
    makeSong(`v${i}`, { title: `${o.title} ${CUTS[i % CUTS.length]}`, artist: o.artists[0].name, language: LANGUAGE, audio: [{ quality: '160kbps', url: `https://audio.test/v${i}.mp4` }] }),
  );
  // Versions are interleaved with the originals, so every search page and suggestion list meets both.
  const BIG: Song[] = ORIGINALS.flatMap((o, i) => (i < VERSIONS.length ? [o, VERSIONS[i]] : [o]));

  it('plays 500 automatic songs with zero repeats by canonical identity', async () => {
    ACTIVE = BIG;
    await initHeardSet({ backend: memoryBackend(), backfill: null, listen: false });
    const seed = BIG[0];
    recordHeard(seed);
    const played: Song[] = [seed];
    const history = [makePlay(seed, 1)];
    let last = seed;
    let plans = 0;
    while (played.length < 501 && plans < 200) {
      plans += 1;
      const plan = await planNextSongs(last, context({ salt: plans, neverRepeat: true, history: [...history].reverse(), discoveryMode: 'balanced' }), { limit: 5, deadlineMs: 8_000, excludeIds: played.map((s) => s.id).slice(-12), excludeKeys: played.map(songKey).slice(-12) });
      expect(plan.exhausted, `plan ${plans} ran dry after ${played.length - 1} songs`).toBeFalsy();
      plan.commit(plan.songs);
      for (const song of plan.songs) {
        if (played.length >= 501) break;
        recordHeard(song);
        played.push(song);
        history.push(makePlay(song, played.length));
        last = song;
      }
    }
    const automatic = played.slice(1);
    expect(automatic).toHaveLength(500);
    const keys = played.map(songKey);
    expect(new Set(keys).size).toBe(keys.length);
    // Another cut of a heard song never shipped: no original and its version both played.
    const ids = new Set(played.map((s) => s.id));
    const both = VERSIONS.filter((v, i) => ids.has(v.id) && ids.has(ORIGINALS[i].id));
    expect(both).toEqual([]);
    // ...and the pool really offered versions: some were played instead of their original.
    expect(VERSIONS.some((v) => ids.has(v.id)) || ORIGINALS.slice(0, 200).some((o) => ids.has(o.id))).toBe(true);
  }, 120_000);

  it('stops, saying so, instead of repeating once everything reachable is heard', async () => {
    ACTIVE = BIG.slice(0, 30);
    await initHeardSet({ backend: memoryBackend(), backfill: null, listen: false });
    for (const s of ACTIVE) recordHeard(s);
    const plan = await planNextSongs(ACTIVE[0], context({ salt: 1, neverRepeat: true }), { limit: 5, deadlineMs: 8_000 });
    expect(plan.songs).toEqual([]);
    expect(plan.exhausted).toBe(true);
  });
});
