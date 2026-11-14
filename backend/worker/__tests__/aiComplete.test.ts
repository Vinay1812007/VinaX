/**
 * The non-streaming completion over the ladder: the text collected from the
 * first model that answers, failover when the first one fails, the JSON
 * variant's extraction, and its one repair turn.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetCooldowns } from '../functions/_lib/ai/cooldown';
import { candidatesFor, completeJson, completeText } from '../functions/_lib/ai/complete';
import { resetSettingsMemo } from '../functions/_lib/settings';
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
    expect(r?.spec?.id).toBe('groq:openai/gpt-oss-120b');
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
    expect(r?.spec?.id).toBe('nvidia:nvidia/nemotron-3.5-bolt-e4b');
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
