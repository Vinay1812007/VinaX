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

import { buildShelfQuery, decadeWord, designShelves, fallbackShelves, filterAvoided, parseShelves } from './homeShelves';

const env = { VINAX_NVD_NEMOTRON_3_5_LIGHTNING_30B_A3B: 'k' };
const taste = { preferredLanguages: ['telugu', 'hindi'], topArtists: ['Sid Sriram', 'Anirudh'], timeOfDay: 'evening' };

beforeEach(() => { chatMock.mockReset(); gatherMock.mockReset(); gatherMock.mockResolvedValue([]); });

describe('buildShelfQuery / decadeWord', () => {
  it('writes the catalogue phrasings that return in-language songs', () => {
    expect(buildShelfQuery('artist', 'Telugu', 'Sid Sriram')).toBe('sid sriram telugu songs');
    expect(buildShelfQuery('mood', 'telugu', 'chill')).toBe('telugu melody songs');
    expect(buildShelfQuery('mood', 'hindi', 'heartbreak')).toBe('hindi emotional songs');
    expect(buildShelfQuery('mood', 'hindi', 'under-the-radar')).toBeNull();
    expect(buildShelfQuery('era', 'telugu', '1990s')).toBe('telugu 90s hits');
    expect(buildShelfQuery('era', 'hindi', "80's")).toBe('hindi 80s hits');
    expect(buildShelfQuery('era', 'tamil', '2000s')).toBe('tamil 2000s hits');
    expect(buildShelfQuery('era', 'tamil', 'modern times')).toBeNull();
    expect(buildShelfQuery('fresh', 'telugu', '', 2026)).toBe('latest telugu songs 2026');
    expect(buildShelfQuery('classics', 'telugu', '')).toBe('telugu evergreen hits');
    expect(buildShelfQuery('artist', 'telugu', 'a very long subject that is clearly not a single artist name at all')).toBeNull();
  });
  it('reads decades in the forms models write', () => {
    expect(decadeWord('nineties')).toBe('90s');
    expect(decadeWord('2010s')).toBe('2010s');
    expect(decadeWord('1970')).toBe('70s');
    expect(decadeWord('1995')).toBeNull();
  });
});

describe('parseShelves / filterAvoided', () => {
  it('builds each query from kind + subject, in an allowed language, and drops markup and duplicates', () => {
    const out = parseShelves(JSON.stringify({ sections: [
      { kind: 'mood', language: 'telugu', subject: 'melody', title: 'Evening Telugu melodies', why: 'Slow songs for now.', description: 'Wind down.' },
      { kind: 'mood', language: 'telugu', subject: 'calm', title: 'Same search, other title' },
      { kind: 'artist', language: 'tamil', subject: 'Anirudh', title: 'Not a listener language' },
      { kind: 'artist', language: 'telugu', subject: 'Sid Sriram', title: '<b>Bad</b>' },
      { kind: 'artist', language: 'telugu', subject: 'Sid Sriram', title: 'Sid Sriram, up close' },
    ] }), taste);
    expect(out.map((s) => s.title)).toEqual(['Evening Telugu melodies', 'Sid Sriram, up close']);
    expect(out[0]).toMatchObject({ query: 'telugu melody songs', language: 'telugu', kind: 'mood', type: 'mood', description: 'Wind down.', why: 'Slow songs for now.' });
    expect(out[1]).toMatchObject({ query: 'sid sriram telugu songs', type: 'artist' });
    expect(parseShelves('junk')).toEqual([]);
  });

  it('keeps at most two artist or composer shelves', () => {
    const out = parseShelves(JSON.stringify({ sections: ['A', 'B', 'C'].map((n) => ({ kind: 'artist', language: 'telugu', subject: `Singer ${n}`, title: `More ${n}` })) }), taste);
    expect(out).toHaveLength(2);
  });

  it('rejects legacy free-form queries that the catalogue matches as titles', () => {
    const out = parseShelves(JSON.stringify({ sections: [
      { title: 'Deep cuts', query: 'telugu anirudh under-the-radar hits' },
      { title: 'Unplugged', query: 'telugu mtv unplugged classic tracks' },
      { title: 'No language', query: 'evening vibes' },
      { title: 'Fine', query: 'telugu melody tracks' },
    ] }), taste);
    expect(out.map((s) => [s.title, s.query])).toEqual([['Fine', 'telugu melody songs']]);
  });

  it('filters shelves the listener saw recently by title or query', () => {
    const shelves = parseShelves(JSON.stringify({ sections: [{ kind: 'fresh', title: 'A' }, { kind: 'trending', title: 'B' }, { kind: 'classics', title: 'C' }] }), taste);
    expect(filterAvoided(shelves, [{ title: 'a' }, { query: 'TELUGU EVERGREEN HITS' }]).map((s) => s.title)).toEqual(['B']);
    expect(filterAvoided(shelves, undefined)).toHaveLength(3);
  });
});

describe('fallbackShelves', () => {
  it('always yields 4–6 on-language shelves and rotates the lead with the seed', () => {
    const a = fallbackShelves(taste, 'seed-1');
    expect(a.length).toBeGreaterThanOrEqual(4);
    expect(a.length).toBeLessThanOrEqual(6);
    expect(a.every((s) => /telugu|hindi/.test(s.query) && (s.language === 'telugu' || s.language === 'hindi'))).toBe(true);
    expect(a.some((s) => s.type === 'artist')).toBe(true);
    expect(new Set(['seed-1', 'seed-2', 'seed-3', 'seed-4', 'seed-5'].map((x) => fallbackShelves(taste, x)[0].title)).size).toBeGreaterThan(1);
    expect(fallbackShelves({}).every((s) => s.query.includes('hindi'))).toBe(true);
    expect(fallbackShelves({ preferredLanguages: ['hindi'], avoidLanguages: ['hindi'], topLanguages: [] }).length).toBe(0);
  });
});

describe('designShelves', () => {
  it('curates from pitches, tops a short set up and reports the model', async () => {
    gatherMock.mockResolvedValue([JSON.stringify({ sections: [{ kind: 'film', language: 'telugu', subject: 'Pushpa', title: 'Pitch one' }] })]);
    chatMock.mockResolvedValue({ content: JSON.stringify({ sections: [{ kind: 'mood', language: 'telugu', subject: 'romantic', title: 'Curated A', why: 'w' }, { kind: 'era', language: 'hindi', subject: '1990s', title: 'Curated B' }] }), model: 'm', keyRole: 'maestro' });
    const r = await designShelves(env, { taste, visitNonce: 7, avoidShelves: [] });
    expect(r.usedAi).toBe(true);
    expect(r.model).toBe('m');
    expect(r.sections.slice(0, 2).map((s) => s.query)).toEqual(['telugu romantic songs', 'hindi 90s hits']);
    expect(r.sections.length).toBeGreaterThanOrEqual(4);
    const call = chatMock.mock.calls[0] as unknown as [unknown, Array<{ content: string }>, { lane: string }];
    expect(call[1][1].content).toContain('Pitch one');
    expect(call[1][1].content).not.toMatch(/under-the-radar|unplugged/i);
    expect(call[2].lane).toBe('maestro');
  });

  it('falls back to the pitches, then to deterministic shelves, and only an unconfigured AI yields nothing', async () => {
    gatherMock.mockResolvedValue([JSON.stringify({ sections: [{ kind: 'fresh', language: 'telugu', title: 'Pitch one' }, { kind: 'trending', language: 'telugu', title: 'Pitch two' }, { kind: 'classics', language: 'telugu', title: 'Pitch three' }] })]);
    chatMock.mockResolvedValue({ content: null, model: null, error: 'failed', status: 500 });
    const pitched = await designShelves(env, { taste, avoidShelves: [{ title: 'Pitch two' }] });
    expect(pitched.sections.slice(0, 2).map((s) => s.title)).toEqual(['Pitch one', 'Pitch three']);
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
