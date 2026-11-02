// @vitest-environment jsdom
/**
 * The AI Home Builder on the device: the hand-written type guard, what is
 * accepted from a layout that passes it, what the request carries (summaries
 * and opaque seed keys only), the 2.5 s deadline, and the decision made once
 * per generation — the AI's when it answers in time, `orderHomeBlocks` exactly
 * as before when it does not, and never replaced by a late answer.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeContext, makePlay, makeSong, warmProfile } from '@/__fixtures__/songs';

vi.mock('@/services/auth/google', () => ({ currentAccount: () => ({ session: 'session-token' }) }));

import { resetMusicAi } from '@/services/ai/musicAi';
import { orderHomeBlocks } from '@/features/home/homeOrder';
import { emptySignals } from '@/features/home/homeSignals';
import type { HomeSection } from '@/services/recommendation/homeDesign';
import {
  acceptHomeLayout, buildHomeRequest, decideHomeLayout, isHomeLayout, peekHomeDecision, pickHomeSeeds, requestAiHomeLayout, resetHomeDecision,
  type AcceptRules, type HomeLayout,
} from './homeBuilder';

const BASE: HomeSection[] = ['quick', 'personal', 'discovery', 'charts', 'moods', 'loved', 'feed'];
const RULES: AcceptRules = { generation: 3, allowed: [...BASE, 'rightnow'], seedKeys: new Set(['s0', 's1']), avoid: ['charts'] };
const block = (type: string, extra: Record<string, unknown> = {}) => ({ type, title: `Title ${type}`, reason: `Because ${type} fits now`, ...extra });
const layoutOf = (...blocks: Array<Record<string, unknown>>): HomeLayout => ({ generation: 3, blocks: blocks as unknown as HomeLayout['blocks'] });
const fallback = () => orderHomeBlocks({ base: BASE, hour: 21, now: 0, signals: emptySignals() });

beforeEach(() => {
  resetHomeDecision();
  resetMusicAi();
});

describe('isHomeLayout — the type guard', () => {
  it('accepts the documented shape', () => {
    expect(isHomeLayout(layoutOf(block('quick'), block('rightnow', { query: 'late night drive', mood: 'chill', language: 'telugu', seedIds: ['s0'] })))).toBe(true);
  });

  it.each([
    ['not an object', 'layout'],
    ['an array', []],
    ['no generation', { blocks: [block('quick')] }],
    ['a fractional generation', { generation: 1.5, blocks: [block('quick')] }],
    ['no blocks', { generation: 1, blocks: [] }],
    ['a block with no type', { generation: 1, blocks: [{ title: 'x', reason: 'y' }] }],
    ['an over-long title', { generation: 1, blocks: [block('quick', { title: 'x'.repeat(49) })] }],
    ['an empty reason', { generation: 1, blocks: [block('quick', { reason: '  ' })] }],
    ['seed ids that are not a list', { generation: 1, blocks: [block('rightnow', { seedIds: 's0' })] }],
    ['too many seed ids', { generation: 1, blocks: [block('rightnow', { seedIds: ['s0', 's1', 's2', 's3'] })] }],
    ['a numeric query', { generation: 1, blocks: [block('rightnow', { query: 42 })] }],
  ])('rejects %s', (_label, value) => {
    expect(isHomeLayout(value)).toBe(false);
  });
});

describe('acceptHomeLayout', () => {
  it('keeps allowed types once each, drops avoided and unknown ones, and anchors the shortcuts and the feed', () => {
    const out = acceptHomeLayout(layoutOf(block('feed'), block('personal'), block('charts'), block('made-up'), block('quick'), block('personal'), block('loved'), block('moods')), RULES)!;
    expect(out.blocks.map((b) => b.type)).toEqual(['quick', 'personal', 'loved', 'moods', 'feed']);
  });

  it('keeps only seeds the device offered, and drops a "right now" shelf with nothing to feed it', () => {
    const fed = acceptHomeLayout(layoutOf(block('quick'), block('personal'), block('loved'), block('rightnow', { seedIds: ['s1', 'song-123'] })), RULES)!;
    expect(fed.blocks[3].seedIds).toEqual(['s1']);
    const unfed = acceptHomeLayout(layoutOf(block('quick'), block('personal'), block('loved'), block('moods'), block('rightnow', { seedIds: ['song-123'] })), RULES)!;
    expect(unfed.blocks.map((b) => b.type)).not.toContain('rightnow');
  });

  it('refuses another generation, fewer than four shelves, and markup in the words', () => {
    expect(acceptHomeLayout({ ...layoutOf(block('quick'), block('personal'), block('loved'), block('moods')), generation: 2 }, RULES)).toBeNull();
    expect(acceptHomeLayout(layoutOf(block('quick'), block('personal'), block('loved')), RULES)).toBeNull();
    const marked = acceptHomeLayout(layoutOf(block('quick', { title: '<b>Hi</b>' }), block('personal'), block('loved'), block('moods'), block('feed')), RULES)!;
    expect(marked.blocks.map((b) => b.type)).toEqual(['personal', 'loved', 'moods', 'feed']);
  });
});

describe('the request and its answer', () => {
  const ctx = () => makeContext({
    profile: warmProfile(0),
    pinnedLanguages: ['telugu'],
    favorites: [makeSong('fav', { title: 'Private Favourite', artist: 'Singer A' })],
    history: [makePlay(makeSong('h1', { title: 'Private Play', artist: 'Singer B' }), 1)],
  });

  it('sends summaries and opaque seed keys, never a title or a catalogue id', () => {
    const c = ctx();
    const seeds = pickHomeSeeds(c);
    const body = buildHomeRequest(c, { generation: 3, allowed: [...BASE, 'rightnow'], avoid: ['charts'], seeds });
    const text = JSON.stringify(body);
    expect(body.seeds.map((s) => s.key)).toEqual(['s0', 's1']);
    expect(body.allowed).not.toContain('charts');
    expect(text).not.toContain('Private');
    expect(text).not.toContain('"fav"');
    expect(Object.keys(body).sort()).toEqual(['allowed', 'avoid', 'generation', 'intent', 'seeds', 'taste']);
  });

  it('guards and accepts the answer, and gives up at the deadline', async () => {
    const c = ctx();
    const seeds = pickHomeSeeds(c);
    const body = buildHomeRequest(c, { generation: 3, allowed: [...BASE, 'rightnow'], avoid: [], seeds });
    const good = vi.fn(async () => new Response(JSON.stringify({ layout: layoutOf(block('quick'), block('personal'), block('loved'), block('moods')) }), { status: 200 })) as unknown as typeof fetch;
    expect((await requestAiHomeLayout(body, { seedKeys: new Set(['s0']), fetcher: good }))!.blocks).toHaveLength(4);
    const malformed = vi.fn(async () => new Response(JSON.stringify({ layout: { generation: 3, blocks: 'quick' } }), { status: 200 })) as unknown as typeof fetch;
    expect(await requestAiHomeLayout(body, { seedKeys: new Set(), fetcher: malformed })).toBeNull();
    const never = vi.fn(() => new Promise<Response>(() => undefined)) as unknown as typeof fetch;
    const t0 = Date.now();
    expect(await requestAiHomeLayout(body, { seedKeys: new Set(), fetcher: never, deadlineMs: 80 })).toBeNull();
    expect(Date.now() - t0).toBeLessThan(1_000);
  });
});

describe('decideHomeLayout — once per generation', () => {
  const ai = (blocks = [block('loved'), block('quick'), block('moods'), block('personal')]) => async () => ({ layout: acceptHomeLayout(layoutOf(...blocks), RULES), seeds: new Map() });

  it('uses the AI’s layout when it answers in time', async () => {
    const d = await decideHomeLayout('3|ai|base', ai(), fallback);
    expect(d.source).toBe('ai');
    expect(d.blocks.map((b) => b.type)).toEqual(['quick', 'loved', 'moods', 'personal']);
  });

  it('falls back to orderHomeBlocks exactly when the AI is late, down or wrong', async () => {
    for (const ask of [async () => ({ layout: null, seeds: new Map() }), async () => { throw new Error('down'); }]) {
      resetHomeDecision();
      const d = await decideHomeLayout('3|ai|base', ask, fallback);
      expect(d.source).toBe('fallback');
      expect(d.blocks.map((b) => b.type)).toEqual(fallback());
    }
  });

  it('never changes once decided: a second ask for the same generation gets the first decision', async () => {
    const first = await decideHomeLayout('3|ai|base', async () => ({ layout: null, seeds: new Map() }), fallback);
    const second = await decideHomeLayout('3|ai|base', ai(), fallback);
    expect(second).toBe(first);
    expect(peekHomeDecision('3|ai|base')).toBe(first);
    // A new generation decides afresh.
    expect((await decideHomeLayout('4|ai|base', ai(), fallback)).source).toBe('ai');
  });

  it('decides at once, without asking, when the AI is not allowed', () => {
    void decideHomeLayout('3|own|base', null, fallback);
    expect(peekHomeDecision('3|own|base')?.source).toBe('fallback');
  });
});
