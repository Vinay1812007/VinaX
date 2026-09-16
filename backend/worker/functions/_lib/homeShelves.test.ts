/**
 * v6.5.0 — the Home Builder's server half: pitches feed the curate, the
 * curate is validated and steered off recent shelves, and a deterministic
 * on-taste fallback keeps Home populated whenever any engine is configured.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const chatMock = vi.fn();
const gatherMock = vi.fn(async (): Promise<string[]> => []);
vi.mock('./ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ai')>();
  return { ...actual, chat: (...args: unknown[]) => chatMock(...args), gather: (...args: unknown[]) => gatherMock(...(args as [])) };
});

import { designShelves, fallbackShelves, filterAvoided, parseShelves } from './homeShelves';

const env = { VINAX_NVD_NEMOTRON_3_5_LIGHTNING_30B_A3B: 'k' };
const taste = { preferredLanguages: ['telugu', 'hindi'], topArtists: ['Sid Sriram', 'Anirudh'], timeOfDay: 'evening' };

beforeEach(() => { chatMock.mockReset(); gatherMock.mockReset(); gatherMock.mockResolvedValue([]); });

describe('parseShelves / filterAvoided', () => {
  it('keeps clean, unique shelves with optional description and type, and drops markup', () => {
    const out = parseShelves(JSON.stringify({ sections: [
      { title: 'Evening Telugu melodies', query: 'telugu evening melodies', why: 'Slow songs for now.', description: 'Wind down.', type: 'time' },
      { title: 'evening telugu melodies', query: 'other' },
      { title: 'Dup query', query: 'Telugu Evening Melodies' },
      { title: '<b>Bad</b>', query: 'x' },
      { title: 'Sid Sriram hits', query: 'sid sriram telugu hits' },
    ] }));
    expect(out.map((s) => s.title)).toEqual(['Evening Telugu melodies', 'Sid Sriram hits']);
    expect(out[0]).toMatchObject({ description: 'Wind down.', type: 'time', why: 'Slow songs for now.' });
    expect(out[1].description).toBeUndefined();
    expect(parseShelves('junk')).toEqual([]);
  });

  it('filters shelves the listener saw recently by title or query', () => {
    const shelves = parseShelves(JSON.stringify({ sections: [{ title: 'A', query: 'qa' }, { title: 'B', query: 'qb' }, { title: 'C', query: 'qc' }] }));
    expect(filterAvoided(shelves, [{ title: 'a' }, { query: 'QC' }]).map((s) => s.title)).toEqual(['B']);
    expect(filterAvoided(shelves, undefined)).toHaveLength(3);
  });
});

describe('fallbackShelves', () => {
  it('always yields 4–6 on-language shelves and rotates the lead with the seed', () => {
    const a = fallbackShelves(taste, 'seed-1');
    const b = fallbackShelves(taste, 'seed-2');
    expect(a.length).toBeGreaterThanOrEqual(4);
    expect(a.length).toBeLessThanOrEqual(6);
    expect(a.every((s) => /telugu|hindi/.test(s.query))).toBe(true);
    expect(a.some((s) => s.type === 'artist')).toBe(true);
    expect(new Set([a[0].title, b[0].title, fallbackShelves(taste, 'seed-3')[0].title, fallbackShelves(taste, 'seed-4')[0].title]).size).toBeGreaterThan(1);
    expect(fallbackShelves({}).every((s) => s.query.includes('hindi'))).toBe(true);
  });
});

describe('designShelves', () => {
  it('curates from pitches and reports the model', async () => {
    gatherMock.mockResolvedValue([JSON.stringify({ sections: [{ title: 'Pitch one', query: 'telugu pitch one' }] })]);
    chatMock.mockResolvedValue({ content: JSON.stringify({ sections: [{ title: 'Curated A', query: 'telugu a', why: 'w' }, { title: 'Curated B', query: 'telugu b' }] }), model: 'm', keyRole: 'dj' });
    const r = await designShelves(env, { taste, visitNonce: 7, avoidShelves: [] });
    expect(r.usedAi).toBe(true);
    expect(r.model).toBe('m');
    expect(r.sections.map((s) => s.title)).toEqual(['Curated A', 'Curated B']);
    const prompt = (chatMock.mock.calls[0] as unknown as [unknown, Array<{ content: string }>])[1][1].content;
    expect(prompt).toContain('Pitch one');
  });

  it('falls back to the pitches, then to deterministic shelves, and only an unconfigured AI yields nothing', async () => {
    gatherMock.mockResolvedValue([JSON.stringify({ sections: [{ title: 'Pitch one', query: 'telugu pitch one' }, { title: 'Pitch two', query: 'telugu pitch two' }, { title: 'Pitch three', query: 'telugu pitch three' }] })]);
    chatMock.mockResolvedValue({ content: null, model: null, error: 'failed', status: 500 });
    const pitched = await designShelves(env, { taste, avoidShelves: [{ title: 'Pitch two' }] });
    expect(pitched.sections.map((s) => s.title)).toEqual(['Pitch one', 'Pitch three']);
    expect(pitched.usedAi).toBe(true);
    gatherMock.mockResolvedValue([]);
    const cold = await designShelves(env, { taste });
    expect(cold.usedAi).toBe(false);
    expect(cold.model).toBe('fallback');
    expect(cold.sections.length).toBeGreaterThanOrEqual(4);
    chatMock.mockResolvedValue({ content: null, model: null, error: 'not_configured' });
    const off = await designShelves({}, { taste });
    expect(off.sections).toEqual([]);
    expect(off.error).toBe('not_configured');
  });
});
