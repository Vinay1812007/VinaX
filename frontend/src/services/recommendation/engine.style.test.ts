// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';
import type { Candidate } from './types';
import { makeContext, makePlay, makeSong, warmProfile } from '@/__fixtures__/songs';

/**
 * 8.3.0 — a DJ remix (or a folk song, or a devotional song) keeps its style:
 * the next stretch is drawn from that style while the pool holds it, film
 * songs fill only what it cannot, one remix of a song ships per sitting, and
 * the AI DJ is told the style and may not water it down.
 */
let pool: Candidate[] = [];
const djSequence = vi.fn();
const generate = vi.fn(async (..._args: unknown[]) => pool);
vi.mock('./candidates', () => ({ gatherCandidates: vi.fn(async () => pool), generateNextCandidates: (...args: unknown[]) => generate(...args) }));
vi.mock('@/services/ai/recommendations', () => ({ enrichSongs: vi.fn(async (songs: Song[]) => songs), aiRerankSongs: vi.fn(async (songs: Song[]) => songs) }));
vi.mock('@/services/ai/dj', () => ({ djSequence: (...args: unknown[]) => djSequence(...args), samplePool: (songs: Song[]) => songs, commitDjSet: vi.fn(), lastDjOutcome: () => 'ok' }));
vi.mock('@/services/queryClient', () => ({ queryClient: { getQueryData: () => undefined } }));

import { planNextSongs, recommendNextSongs } from './engine';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useReasonStore } from '@/store/reasonStore';
import { resetTransitionMemory } from './transitions';
import { resetRecMemory } from './recMemory';
import { matchesStyle } from './style';

const NOW = 1_800_000_000_000;
const cand = (song: Song, source: Candidate['source'] = 'related'): Candidate => ({ song, source });
const djSong = (id: string, title: string, artist: string, over: Partial<Song> = {}) => makeSong(id, { title: `${title} (DJ Remix Song)`, artist, album: { id: `al-${id}`, name: `${title} (DJ Remix Song)` }, playCount: 600_000, ...over });
const folkSong = (id: string, title: string, artist: string) => makeSong(id, { title, artist, album: { id: 'al-folk', name: 'Telugu Folk Songs Telangana Janapadalu Vol - 6' }, playCount: 300_000 });
const film = (id: string, artist: string) => makeSong(id, { title: `Film ${id}`, artist, album: { id: 'al-film', name: 'A Film' }, playCount: 60_000_000 });
const ctx = (over = {}) => makeContext({ profile: warmProfile(NOW), pinnedLanguages: ['telugu'], surface: 'next', ...over });
const DJ_ARTISTS = ['Peddapuli Eshwar', 'P.N. Lingaraju', 'Clement', 'Ashok', 'Dhanraj Bobuli', 'Hema Chandra', 'Anil Kumar', 'Sunil Kumar'];
const DJ_TITLES = ['Mayadari Maisamma', 'Peddha Puli', 'Yellu Yelluraave Yellamma', 'Kallu Thaagi', 'Lamba Lamba Kamba Meeda', 'Chuttu Muttu Hyderabadu', 'Nalla Nallani Pori', 'Pattu Cheera Pattu Raika', 'Balamani Balamani', 'Mama Nagulo'];

/** A realistic mixed pool: the seed's suggestions are mostly popular film songs; the remixes are fewer and less played. */
function djPool(): Candidate[] {
  return [
    ...Array.from({ length: 12 }, (_, i) => cand(film(`film${i}`, `Film Singer ${i}`))),
    ...DJ_TITLES.map((t, i) => cand(djSong(`dj${i}`, t, DJ_ARTISTS[i % DJ_ARTISTS.length]), i % 2 ? 'style' : 'related')),
  ];
}
const seed = djSong('seed', 'Nadakallo Nadaka', 'P.N. Lingaraju');
const lastGatherCtx = (): unknown => generate.mock.calls[generate.mock.calls.length - 1]?.[1];

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetTransitionMemory();
  resetRecMemory();
  djSequence.mockReset();
  generate.mockClear();
  useSettingsStore.setState({ aiDj: false, aiAssist: false, kidMode: false, mutedLanguages: [] });
  useLibraryStore.setState({ hiddenSongIds: [], hiddenArtists: [] });
});

describe('8.3.0 — a style keeps going', () => {
  it('a DJ remix seed gets four or more DJ remixes in the next five, though film songs dominate the pool', async () => {
    for (const salt of [1, 2, 3, 4, 5]) {
      pool = djPool();
      const out = await recommendNextSongs(seed, ctx({ salt }), { limit: 5 });
      expect(out).toHaveLength(5);
      expect(out.filter((s) => matchesStyle(s, 'dj')).length, `salt ${salt}`).toBeGreaterThanOrEqual(4);
    }
    // The gather was asked for the style.
    expect(generate.mock.calls[0][1]).toMatchObject({ style: 'dj' });
  });

  it('an ordinary seed is not pushed into a style', async () => {
    pool = djPool();
    const out = await recommendNextSongs(film('plain', 'Sid Sriram'), ctx(), { limit: 5 });
    expect(generate.mock.calls[0][1]).toMatchObject({ style: null });
    expect(out.filter((s) => matchesStyle(s, 'dj')).length).toBeLessThan(4);
  });

  it('a folk seed (folk only in its album name) keeps to folk songs', async () => {
    const folkSeed = folkSong('fseed', 'Varsaina Dana O Attakutura', 'Vadlakonda Anilkumar');
    pool = [...Array.from({ length: 12 }, (_, i) => cand(film(`film${i}`, `Film Singer ${i}`))), ...['Mama koduka mallesha', 'Chelle Chandramma', 'Daldhadi Nenu Ready', 'Edella kalam idemi Gosa', 'Oyavvo Oddante', 'Erra Erra Buggala', 'Abbabba gaa Pori'].map((t, i) => cand(folkSong(`folk${i}`, t, ['A. Ramadevi', 'Jadala Ramesh', 'Akunuri Devayya', 'Vadlakonda Anilkumar'][i % 4])))];
    const out = await recommendNextSongs(folkSeed, ctx(), { limit: 5 });
    expect(out.filter((s) => matchesStyle(s, 'folk')).length).toBeGreaterThanOrEqual(4);
  });

  it('never returns nothing when the pool holds no song in the style', async () => {
    pool = Array.from({ length: 10 }, (_, i) => cand(film(`film${i}`, `Film Singer ${i}`)));
    const plan = await planNextSongs(seed, ctx(), { limit: 5 });
    expect(plan.songs).toHaveLength(5);
    expect(plan.relaxed).toContain('style');
  });

  it('ships one remix of a song, whoever remixed it and however many "Version N" cuts exist', async () => {
    pool = [
      ...djPool(),
      cand(djSong('v5', 'Mayadari Maisamma', 'Peddapuli Eshwar', { title: 'Mayadari Maisamma (Dj Remix Version 2)' }), 'style'),
      cand(djSong('other-dj', 'Mayadari Maisamma', 'Dj Ganesh', { title: 'Mayadari Maisamma - Dj Remix' }), 'style'),
      // A remix of the seed itself by another DJ.
      cand(djSong('seed-again', 'Nadakallo Nadaka', 'Dj Nitish', { title: 'Nadakallo Nadaka Remix By Dj Nitish' }), 'style'),
    ];
    const out = await recommendNextSongs(seed, ctx(), { limit: 10 });
    const titles = out.map((s) => s.title.replace(/\s*[-(].*$/, '').replace(/ Remix By.*$/, ''));
    expect(new Set(titles).size).toBe(titles.length);
    expect(titles).not.toContain('Nadakallo Nadaka');
  });

  it('does not count unknown remix DJs as discoveries to ration: Familiar mode still keeps the style', async () => {
    pool = djPool();
    const plan = await planNextSongs(seed, ctx({ discoveryMode: 'familiar' }), { limit: 5 });
    expect(plan.songs.filter((s) => matchesStyle(s, 'dj')).length).toBeGreaterThanOrEqual(4);
    expect([...plan.discoveryIds].some((id) => id.startsWith('dj'))).toBe(false);
  });

  it('says why: "Keeps the DJ remix going"', async () => {
    pool = djPool();
    const out = await recommendNextSongs(seed, ctx(), { limit: 5 });
    const styled = out.find((s) => matchesStyle(s, 'dj'))!;
    expect(useReasonStore.getState().reasons[styled.id]).toMatch(/^Keeps the DJ remix going/);
  });

  it('carries the style past a stray pick, and a hand-played ordinary song clears it', async () => {
    const history = [djSong('h1', 'Silaka', 'Laxmi Dasa'), djSong('h2', 'Koi Koi Kodini Koy', 'Mesala Gurrappa'), film('h3', 'X')].map((s, i) => makePlay(s, NOW - (i + 1) * 300_000));
    pool = djPool();
    const stray = film('stray', 'Film Singer Z');
    await planNextSongs(stray, ctx({ history }), { limit: 5, previous: djSong('next', 'Jubilee Hills Peddamma Thalli Bonalu', 'Hema Chandra') });
    expect(lastGatherCtx()).toMatchObject({ style: 'dj' });
    await planNextSongs(stray, ctx({ history }), { limit: 5, previous: null });
    expect(lastGatherCtx()).toMatchObject({ style: null });
  });

  it('a DJ remix or Folk tune sets the style for any seed; a mood tune clears it', async () => {
    pool = djPool();
    await planNextSongs(film('plain', 'Sid Sriram'), ctx(), { limit: 5, tune: 'dj' });
    expect(lastGatherCtx()).toMatchObject({ style: 'dj', intentQuery: 'telugu dj remix' });
    await planNextSongs(seed, ctx(), { limit: 5, tune: 'romantic' });
    expect(lastGatherCtx()).toMatchObject({ style: null });
  });

  it('tells the AI DJ the style, and turns away an order that drops it', async () => {
    useSettingsStore.setState({ aiDj: true, aiAssist: true });
    pool = djPool();
    // The DJ answers with film songs only.
    djSequence.mockImplementation(async (_seed: Song, _ctx: unknown, p: Song[]) => ({ intro: '', picks: p.filter((s) => !matchesStyle(s, 'dj')).slice(0, 5).map((song) => ({ song, reason: 'x', segue: '' })) }));
    const plan = await planNextSongs(seed, ctx(), { limit: 5, aiBudgetMs: 10_000 });
    expect(plan.refinement).not.toBeNull();
    const refined = await plan.refinement!;
    expect(djSequence.mock.calls[0][5]).toMatchObject({ style: 'dj' });
    expect(refined).toEqual({ rejected: 'ai_rejected' });
  });
});
