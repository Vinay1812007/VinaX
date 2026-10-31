/**
 * The non-streaming completion over the ladder: the text collected from the
 * first model that answers, failover when the first one fails, the JSON
 * variant's extraction, and its one repair turn. Also the composer end to
 * end with a stubbed provider: the page it shapes, and the deterministic
 * page when the provider is down.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetCooldowns } from '../functions/_lib/ai/cooldown';
import { candidatesFor, completeJson, completeText } from '../functions/_lib/ai/complete';
import { resetSettingsMemo } from '../functions/_lib/settings';
import { composeHome } from '../functions/_lib/personal/compose';
import { emptyTaste } from '../functions/_lib/personal/taste';
import type { Shelf, SongRecord } from '../functions/_lib/personal/types';
import { DB_ENV, fakeDb } from './helpers/fakeDb';
import { openAiSse, sseResponse } from './helpers/aiStreams';

const ENV = { ...DB_ENV, GROQ_API_KEY: 'gsk_test', NVIDIA_API_KEY: 'nv_test' };

type Upstream = (url: string, init?: RequestInit) => Response | Promise<Response>;
const seed = (upstream: Upstream) => fakeDb({ settings: [{ key: 'vinax-ai', value: { enabled: true } }] }, upstream);

beforeEach(() => { resetSettingsMemo(); _resetCooldowns(); });
afterEach(() => vi.unstubAllGlobals());

describe('completeText', () => {
  it('collects the answer from the first model of the ladder', async () => {
    seed(() => sseResponse(openAiSse('The answer is 42.')));
    const r = await completeText(ENV, { system: 'Answer.', user: 'What?' });
    expect(r?.text).toBe('The answer is 42.');
    expect(r?.spec?.provider).toBe('groq');
  });

  it('falls over to the next model when the first fails before any text', async () => {
    let calls = 0;
    seed((url) => {
      calls += 1;
      if (url.includes('groq')) return new Response('{"error":"down"}', { status: 503 });
      return sseResponse(openAiSse('From the second.'));
    });
    const r = await completeText(ENV, { system: 's', user: 'u' });
    expect(r?.text).toBe('From the second.');
    expect(r?.spec?.provider).toBe('nvidia');
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it('is null with no provider configured', async () => {
    seed(() => sseResponse(openAiSse('x')));
    expect(await completeText(DB_ENV, { system: 's', user: 'u' })).toBeNull();
    expect(await candidatesFor(DB_ENV)).toEqual([]);
  });
});

describe('completeJson', () => {
  const validate = (v: unknown) => (v && typeof v === 'object' && typeof (v as { n?: unknown }).n === 'number' ? (v as { n: number }) : null);

  it('parses JSON out of prose and fences', async () => {
    seed(() => sseResponse(openAiSse('Here you go:\n```json\n{"n": 7}\n```\nDone.')));
    const r = await completeJson(ENV, { system: 's', user: 'u', validate });
    expect(r?.value).toEqual({ n: 7 });
    expect(r?.repaired).toBe(false);
  });

  it('asks the same model once more when the first answer does not validate', async () => {
    let n = 0;
    const bodies: string[] = [];
    seed((_url, init) => {
      n += 1;
      bodies.push(String(init?.body ?? ''));
      return sseResponse(openAiSse(n === 1 ? '{"n": "seven"}' : '{"n": 7}'));
    });
    const r = await completeJson(ENV, { system: 's', user: 'u', validate });
    expect(r?.value).toEqual({ n: 7 });
    expect(r?.repaired).toBe(true);
    expect(n).toBe(2);
    expect(bodies[1]).toContain('Your previous answer could not be used');
  });

  it('gives up after the repair turn', async () => {
    seed(() => sseResponse(openAiSse('not json at all')));
    expect(await completeJson(ENV, { system: 's', user: 'u', validate })).toBeNull();
    expect(await completeJson(ENV, { system: 's', user: 'u', validate, repair: false })).toBeNull();
  });
});

describe('composeHome', () => {
  const rec = (id: string): SongRecord => ({ id, title: `Song ${id}`, artist: `Artist ${id[0]}`, artistId: null, artists: [], album: null, albumId: null, language: 'telugu', year: 2024, duration: 200, image: null, facets: {} });
  const shelf = (key: string, n: number): Shelf => ({ key, title: key, reason: `why ${key}`, songs: Array.from({ length: n }, (_, i) => rec(`${key[0]}${i}`)) });
  const shelves = [shelf('made-for-you', 20), shelf('discover', 12), shelf('trending', 8)];
  const ctx = { taste: emptyTaste(), firstName: 'Asha', hour: 21, dow: 6, festival: null };

  it('applies the model\'s page: order, names, a greeting and a themed shelf from the pool', async () => {
    seed(() => sseResponse(openAiSse(JSON.stringify({
      greeting: 'Good evening, Asha',
      shelves: [
        { key: 'themed:late-evening', title: 'Late evening calm', reason: 'Saturday night', songIds: ['m0', 'd0', 't0', 'm1', 'd1', 't1', 'm2'] },
        { key: 'discover', title: 'New for you', reason: 'You like finding things' },
      ],
    }))));
    const r = await composeHome(ENV, shelves, ctx);
    expect(r.composed).toBe(true);
    expect(r.greeting).toBe('Good evening, Asha');
    expect(r.model).toMatch(/^groq:/);
    expect(r.shelves.map((s) => s.key)).toEqual(['themed:late-evening', 'discover', 'made-for-you', 'trending']);
    expect(r.shelves[1].title).toBe('New for you');
    expect(r.shelves[0].songs.map((s) => s.id)).toEqual(['m0', 'd0', 't0', 'm1', 'd1', 't1', 'm2']);
  });

  it('serves the deterministic page when the provider is down or answers nonsense', async () => {
    seed(() => new Response('{"error":"down"}', { status: 503 }));
    const down = await composeHome(ENV, shelves, ctx);
    expect(down.composed).toBe(false);
    expect(down.shelves).toEqual(shelves);
    expect(down.model).toBeNull();
    _resetCooldowns();
    vi.unstubAllGlobals();
    seed(() => sseResponse(openAiSse('I would rather not.')));
    const nonsense = await composeHome(ENV, shelves, ctx);
    expect(nonsense.composed).toBe(false);
    expect(nonsense.shelves).toEqual(shelves);
  });
});
