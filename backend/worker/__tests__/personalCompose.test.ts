/**
 * The composer without a model: JSON extraction and repair material, the
 * answer's validation, and how a composition is applied to the deterministic
 * shelves (ids checked, merges, one themed shelf, left-out shelves appended).
 * Also the playlist builder's plan and curation validators and hard rules.
 */
import { describe, expect, it } from 'vitest';
import { extractJson } from '../functions/_lib/ai/complete';
import { applyComposition, composePrompt, validateComposition } from '../functions/_lib/personal/compose';
import { fallbackPlan, fitsPlan, validateCuration, validatePlan } from '../functions/_lib/personal/playlist';
import { buildShelves, isoWeekOf } from '../functions/_lib/personal/shelves';
import { emptyTaste, foldEvents } from '../functions/_lib/personal/taste';
import type { Scored, Shelf, SongRecord, SongRow } from '../functions/_lib/personal/types';

const NOW = Date.UTC(2026, 9, 31, 12);

describe('extractJson', () => {
  it('finds the first balanced object through fences, prose and reasoning', () => {
    expect(extractJson('Sure! ```json\n{"a": 1, "b": [1, 2]}\n```')).toEqual({ a: 1, b: [1, 2] });
    expect(extractJson('<think>{"not": "this"}</think>\nHere: {"greeting": "Hi", "shelves": []} trailing')).toEqual({ greeting: 'Hi', shelves: [] });
    expect(extractJson('[1, {"x": "}"}]')).toEqual([1, { x: '}' }]);
    expect(extractJson('{"s": "a \\"quoted\\" brace }"}')).toEqual({ s: 'a "quoted" brace }' });
  });
  it('is undefined for no JSON, unbalanced JSON or a mismatched close', () => {
    expect(extractJson('no json here')).toBeUndefined();
    expect(extractJson('{"a": 1')).toBeUndefined();
    expect(extractJson('{"a": 1]')).toBeUndefined();
  });
});

const rec = (id: string, over: Partial<SongRecord> = {}): SongRecord => ({
  id, title: `Song ${id}`, artist: `Artist ${id[0]}`, artistId: `ar${id[0]}`, artists: [{ id: `ar${id[0]}`, name: `Artist ${id[0]}` }],
  album: null, albumId: null, language: 'telugu', year: 2024, duration: 200, image: null, facets: {}, ...over,
});
const shelf = (key: string, ids: string[], title = key): Shelf => ({ key, title, reason: `why ${key}`, songs: ids.map((id) => rec(id)) });
const ids = (prefix: string, n: number, from = 0) => Array.from({ length: n }, (_, i) => `${prefix}${from + i}`);

describe('validateComposition', () => {
  it('accepts the contract and clips the words', () => {
    const c = validateComposition({ greeting: 'Good evening, Asha', shelves: [{ key: 'made-for-you', title: 'For your evening', reason: 'x'.repeat(200), songIds: ['a', 1, 'b'] }, { key: 'merge', from: ['a', 'b'], title: 'Both' }] });
    expect(c?.greeting).toBe('Good evening, Asha');
    expect(c?.shelves[0]).toMatchObject({ key: 'made-for-you', title: 'For your evening', songIds: ['a', 'b'] });
    expect(c?.shelves[0].reason).toHaveLength(120);
    expect(c?.shelves[1].from).toEqual(['a', 'b']);
  });
  it('refuses anything that is not a page', () => {
    expect(validateComposition(null)).toBeNull();
    expect(validateComposition({ shelves: 'nope' })).toBeNull();
    expect(validateComposition({ shelves: [{ title: 'no key' }] })).toBeNull();
    expect(validateComposition({ shelves: [] })).toBeNull();
  });
});

describe('applyComposition', () => {
  const base = [shelf('made-for-you', ids('a', 20)), shelf('language:telugu', ids('b', 12)), shelf('discover', ids('c', 10)), shelf('trending', ids('d', 8))];
  const pool = new Map(base.flatMap((s) => s.songs).map((s) => [s.id, s]));

  it('orders and renames what the model named and appends the rest', () => {
    const out = applyComposition({ greeting: null, shelves: [{ key: 'discover', title: 'Something new tonight', reason: 'You said discover' }, { key: 'made-for-you', title: 'Your mix', reason: '' }] }, base, pool);
    expect(out.map((s) => s.key)).toEqual(['discover', 'made-for-you', 'language:telugu', 'trending']);
    expect(out[0]).toMatchObject({ title: 'Something new tonight', reason: 'You said discover' });
    expect(out[1].reason).toBe('why made-for-you');
    expect(out[0].songs).toHaveLength(10);
  });

  it('adds one themed shelf from pool ids only, never a second, and drops unknown ids', () => {
    const out = applyComposition({ greeting: 'Hi', shelves: [
      { key: 'themed:rainy-evening', title: 'Rainy evening', reason: 'It is pouring', songIds: ['a1', 'b1', 'c1', 'd1', 'a2', 'b2', 'zzz', 'c2'] },
      { key: 'themed:another', title: 'Second', reason: '', songIds: ids('a', 8, 5) },
      { key: 'made-for-you', title: 'Mix', reason: '' },
    ] }, base, pool);
    expect(out[0].key).toBe('themed:rainy-evening');
    expect(out[0].songs.map((s) => s.id)).toEqual(['a1', 'b1', 'c1', 'd1', 'a2', 'b2', 'c2']);
    expect(out.filter((s) => s.key.startsWith('themed:'))).toHaveLength(1);
    // the songs the themed shelf took are not repeated on the shelves that follow
    expect(out[1].songs.map((s) => s.id)).not.toContain('a1');
  });

  it('a themed shelf with too few valid ids is ignored', () => {
    const out = applyComposition({ greeting: null, shelves: [{ key: 'themed:thin', title: 'Thin', reason: '', songIds: ['a1', 'nope', 'b1'] }] }, base, pool);
    expect(out.map((s) => s.key)).toEqual(['made-for-you', 'language:telugu', 'discover', 'trending']);
  });

  it('merges two shelves into one, half from each, and consumes both', () => {
    const out = applyComposition({ greeting: null, shelves: [{ key: 'merge', from: ['language:telugu', 'trending'], title: 'Telugu and trending', reason: 'Two in one' }] }, base, pool);
    expect(out[0].key).toBe('merge:language:telugu+trending');
    expect(out[0].songs.length).toBeGreaterThanOrEqual(16);
    expect(out.map((s) => s.key)).toEqual(['merge:language:telugu+trending', 'made-for-you', 'discover']);
  });

  it('a merge that names one real shelf, or a shelf twice, is ignored', () => {
    const out = applyComposition({ greeting: null, shelves: [{ key: 'merge', from: ['trending', 'ghost'], title: 'X', reason: '' }, { key: 'trending', title: 'T', reason: '' }, { key: 'trending', title: 'T again', reason: '' }] }, base, pool);
    expect(out.map((s) => s.key)).toEqual(['trending', 'made-for-you', 'language:telugu', 'discover']);
    expect(out[0].title).toBe('T');
  });

  it('writes a prompt the model can read, with the pool ids', () => {
    const taste = emptyTaste(NOW);
    const prompt = composePrompt(base, [...pool.values()], { taste, firstName: 'Asha', hour: 21, dow: 6, festival: 'diwali' });
    expect(prompt).toContain('name: Asha');
    expect(prompt).toContain('hour 21:00, Saturday, festival: diwali');
    expect(prompt).toContain('- key: made-for-you');
    expect(prompt).toContain('a1|Song a1 — Artist a|telugu|2024');
  });
});

describe('buildShelves', () => {
  const row = (id: string, over: Partial<SongRow> = {}): SongRow => ({
    ...rec(id), artist_id: `ar${id[0]}`, album_id: null, key: `song ${id}|artist ${id[0]}`, embed_model: 'm', embedded_at: null,
    plays: 10, completes: 5, skips: 0, likes: 1, first_seen: new Date(NOW).toISOString(), last_seen: new Date(NOW).toISOString(), ...over,
  } as SongRow);
  const scored = (id: string, extra: Partial<Scored> & { sources?: string[] } = {}): Scored => ({
    song: row(id), candidate: { id, sources: new Set((extra.sources ?? ['neighbours']) as never[]), seedId: extra.candidate?.seedId },
    score: 1 - Number(id.slice(1)) / 100, reasons: extra.reasons ?? [], cooling: false,
  });

  it('builds the shelves in priority order, one song per shelf, and leaves thin ones out', () => {
    const taste = foldEvents(emptyTaste(NOW), [{ id: 'e', kind: 'like', songId: 'seed', at: NOW }], new Map([['seed', row('seed', { artist: 'Artist s', artist_id: 'ars' })]]), NOW);
    const list: Scored[] = [
      ...ids('a', 30).map((id) => scored(id)),
      ...ids('b', 12).map((id, i) => ({ ...scored(id, { sources: ['similar'] }), song: row(id, { artist: `Artist b${i % 5}`, artist_id: `arb${i % 5}`, key: `song ${id}|artist b${i % 5}` }), candidate: { id, sources: new Set(['similar' as const]), seedId: 'seed' } })),
      ...ids('c', 8).map((id) => scored(id, { sources: ['colisten'] })),
      ...ids('d', 3).map((id) => scored(id, { sources: ['trending'] })),
    ];
    const songs = new Map([...list.map((s) => [s.song.id, s.song] as const), ['seed', row('seed')]]);
    const shelves = buildShelves(list, { taste, songs, now: NOW, hour: null, isoWeek: '2026-W44' });
    const keys = shelves.map((s) => s.key);
    expect(keys[0]).toBe('made-for-you');
    expect(keys).toContain('because:seed');
    expect(keys).toContain('language:telugu');
    expect(keys).not.toContain('trending');
    // one song per shelf, except that the hero may share with the seed shelves
    const rest = shelves.filter((s) => s.key !== 'made-for-you').flatMap((s) => s.songs.map((x) => x.id));
    expect(new Set(rest).size).toBe(rest.length);
    const hero = new Set(shelves[0].songs.map((x) => x.id));
    for (const s of shelves) if (!s.key.startsWith('because:') && !s.key.startsWith('artist:') && s.key !== 'made-for-you') for (const x of s.songs) expect(hero.has(x.id)).toBe(false);
    expect(shelves.find((s) => s.key === 'because:seed')!.title).toBe('Because you liked Song seed');
  });

  it('names the ISO week', () => {
    expect(isoWeekOf(Date.UTC(2026, 0, 1))).toBe('2026-W01');
    expect(isoWeekOf(Date.UTC(2026, 9, 31))).toBe('2026-W44');
  });
});

describe('the playlist builder validators', () => {
  it('reads a plan and clips it', () => {
    const p = validatePlan({ title: 'Wedding night', languages: ['Telugu', 'hindi', 'telugu'], moods: ['Party'], artists: ['DSP'], eras: ['2010s'], energy: 'high', familiarity: 'mixed', queries: ['telugu wedding songs', ' dsp hits '] });
    expect(p).toMatchObject({ title: 'Wedding night', languages: ['telugu', 'hindi'], moods: ['party'], artists: ['DSP'], eras: ['2010s'], energy: 'high', familiarity: 'mixed', queries: ['telugu wedding songs', 'dsp hits'] });
    expect(validatePlan({ energy: 'loud', familiarity: 'x' })).toMatchObject({ title: 'Your playlist', energy: 'any', familiarity: 'mixed', queries: [] });
    expect(validatePlan('nope')).toBeNull();
    expect(fallbackPlan('  slow   telugu songs ').queries).toEqual(['slow telugu songs']);
  });
  it('reads a curation, once per id, strings or objects', () => {
    const c = validateCuration({ title: 'T', description: 'D', songs: ['a', { id: 'b', reason: 'because' }, { id: 'a' }, 7] });
    expect(c?.songs).toEqual([{ id: 'a' }, { id: 'b', reason: 'because' }]);
    expect(validateCuration({ songs: [] })).toBeNull();
  });
  it('applies the plan\'s hard rules', () => {
    const taste = foldEvents(emptyTaste(NOW), [{ id: 'e', kind: 'play', songId: 'k', at: NOW }], new Map(), NOW);
    const mk = (id: string, over: Partial<SongRow> = {}, sources: string[] = ['search']): Scored => ({
      song: { ...rec(id), artist_id: 'x', album_id: null, key: id, embed_model: null, embedded_at: null, plays: 0, completes: 0, skips: 0, likes: 0, first_seen: '', last_seen: '', ...over } as SongRow,
      candidate: { id, sources: new Set(sources as never[]) }, score: 1, reasons: [], cooling: false,
    });
    const plan = { ...fallbackPlan('x'), languages: ['telugu'], eras: ['2020s'] };
    expect(fitsPlan(mk('a'), plan, taste)).toBe(true);
    expect(fitsPlan(mk('b', { language: 'hindi' }), plan, taste)).toBe(false);
    expect(fitsPlan(mk('c', { year: 2012 }), plan, taste)).toBe(false);
    expect(fitsPlan(mk('k'), { ...plan, familiarity: 'new' }, taste)).toBe(false);
    expect(fitsPlan(mk('a', {}, ['neighbours']), { ...plan, familiarity: 'known' }, taste)).toBe(false);
    expect(fitsPlan(mk('k', {}, ['neighbours']), { ...plan, familiarity: 'known' }, taste)).toBe(true);
  });
});
