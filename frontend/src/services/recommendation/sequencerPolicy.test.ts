// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { Song } from '@/types';
import { sequenceSongs } from './sequencer';
import { resetTransitionMemory } from './transitions';

/**
 * 7.2 — the sequencer's policy, made explicit: the language policy, one
 * recording family per stretch (and not a version of what just played), and
 * a traceable list of the soft rules a small pool forced it to relax.
 */
const song = (id: string, title: string, artist: string, extra: Partial<Song> = {}): Song => ({
  kind: 'song', id, title, subtitle: artist, artists: [{ id: `a-${artist}`, name: artist }], album: null, images: [], audio: [],
  duration: 200, language: 'telugu', year: '2020', explicit: false, hasLyrics: false, playCount: null, energy: 0.5, ...extra,
});
const ids = (r: ReturnType<typeof sequenceSongs>) => r.songs.map((s) => s.song.id);

beforeEach(() => resetTransitionMemory());

describe('recording families', () => {
  it('never places two versions of one song in a stretch — the better-ranked cut stays', () => {
    const pool = [song('orig', 'Monica', 'Anirudh'), song('b', 'Other B', 'B'), song('lofi', 'Monica - Lofi Flip', 'Anirudh'), song('c', 'Other C', 'C')];
    const r = sequenceSongs(pool, { limit: 4 });
    expect(ids(r)).toContain('orig');
    expect(ids(r)).not.toContain('lofi');
    expect(r.songs).toHaveLength(3);
  });

  it('does not bring back a version of something that just played', () => {
    const recent = [song('played', 'Monica', 'Anirudh')];
    const pool = [song('remix', 'Monica (Remix)', 'Anirudh'), song('x', 'X', 'X'), song('y', 'Y', 'Y')];
    const r = sequenceSongs(pool, { limit: 2, recent });
    expect(ids(r).sort()).toEqual(['x', 'y']);
    expect(r.relaxed).toEqual([]);
  });

  it('lets such a version back only when the pool cannot fill the stretch otherwise, and reports it', () => {
    const recent = [song('played', 'Monica', 'Anirudh')];
    const r = sequenceSongs([song('remix', 'Monica (Remix)', 'Anirudh'), song('x', 'X', 'X')], { limit: 2, recent });
    expect(ids(r).sort()).toEqual(['remix', 'x']);
    expect(r.relaxed).toEqual(['recent-version']);
    expect(r.relaxations).toContainEqual(expect.objectContaining({ rule: 'recent-version', songId: 'remix' }));
  });

  it('the seed counts as just played', () => {
    const seed = song('seed', 'Monica', 'Anirudh');
    const r = sequenceSongs([song('live', 'Monica (Live)', 'Anirudh'), song('x', 'X', 'X'), song('y', 'Y', 'Y')], { seed, limit: 2 });
    expect(ids(r)).not.toContain('live');
  });
});

describe('traceable relaxations on a small pool', () => {
  it('reports the discovery share and the familiar opening when only discoveries are left', () => {
    const pool = [song('d1', 'D1', 'S1'), song('d2', 'D2', 'S2'), song('d3', 'D3', 'S3')];
    const r = sequenceSongs(pool, { limit: 3, discovery: 0, discoveryIds: new Set(['d1', 'd2', 'd3']) });
    expect(r.songs).toHaveLength(3);
    expect([...r.relaxed].sort()).toEqual(['discovery-share', 'familiar-opening']);
    expect(r.relaxations.find((x) => x.rule === 'familiar-opening')?.slot).toBe(1);
  });

  it('reports a forced back-to-back artist', () => {
    const r = sequenceSongs([song('a1', 'A1', 'Same'), song('a2', 'A2', 'Same')], { limit: 2 });
    expect(r.songs).toHaveLength(2);
    expect(r.relaxed).toEqual(['artist-spacing']);
  });

  it('reports nothing when nothing had to give', () => {
    const pool = [song('k1', 'K1', 'A'), song('k2', 'K2', 'B'), song('d1', 'D1', 'C'), song('k3', 'K3', 'D')];
    const r = sequenceSongs(pool, { limit: 4, discovery: 0.25, discoveryIds: new Set(['d1']), sureIds: new Set(['k1']) });
    expect(r.relaxed).toEqual([]);
    expect(r.relaxations).toEqual([]);
  });
});

describe('language policy', () => {
  const te = (id: string) => song(id, `T ${id}`, `A${id}`);
  const hi = (id: string) => song(id, `H ${id}`, `B${id}`, { language: 'hindi' });

  it("'lock' is strict: another language never enters, even when the stretch comes up short", () => {
    const r = sequenceSongs([te('t1'), hi('h1'), hi('h2')], { limit: 3, language: 'telugu', languagePolicy: 'lock' });
    expect(ids(r)).toEqual(['t1']);
    // 'lock' is the default.
    expect(ids(sequenceSongs([te('t1'), hi('h1'), hi('h2')], { limit: 3, language: 'telugu' }))).toEqual(['t1']);
  });

  it("'prefer' is optional exploration: the target language leads and a familiar language may fill in", () => {
    const r = sequenceSongs([hi('h1'), te('t1'), hi('h2')], { limit: 3, language: 'telugu', languagePolicy: 'prefer', otherLanguages: ['hindi'] });
    expect(r.songs).toHaveLength(3);
    expect(r.songs[0].song.language).toBe('telugu');
    expect(r.songs.filter((s) => s.song.language === 'hindi').every((s) => /hindi detour/.test(s.why))).toBe(true);
  });
});
