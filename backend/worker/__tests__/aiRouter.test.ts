/**
 * VinaX AI — Auto's ladder choice, failover (only before the first answer
 * token), a picked model never swapped, and the cooldown arithmetic.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { _resetCooldowns, AUTH_MS, coolingUntil, GONE_MS, isCooling, noteFailure, QUOTA_DEFAULT_MS, RATE_MAX_MS, restFor, UPSTREAM_MS } from '../functions/_lib/ai/cooldown';
import { ProviderError } from '../functions/_lib/ai/errors';
import { applyOverrides, LADDERS, ladderModels, MODELS, modelById } from '../functions/_lib/ai/models';
import { humanReason, isSmallTalk, pickLadder, runChat, type RouterEvent } from '../functions/_lib/ai/router';
import type { Adapter, ModelSpec, ProviderEvent, ProviderId } from '../functions/_lib/ai/types';

const spec = (id: string): ModelSpec => modelById(MODELS, id)!;
const signals = (over: Partial<Parameters<typeof pickLadder>[0]> = {}) => ({ text: 'Tell me about Indian classical music', threadChars: 100, hasImages: false, hasPdf: false, extendedThinking: false, ...over });

describe('pickLadder', () => {
  it('checks images, then PDFs or long threads, then thinking, then code, then small talk', () => {
    expect(pickLadder(signals({ hasImages: true, hasPdf: true, extendedThinking: true }))).toBe('vision');
    expect(pickLadder(signals({ hasPdf: true, extendedThinking: true }))).toBe('long');
    expect(pickLadder(signals({ threadChars: 150_001 }))).toBe('long');
    expect(pickLadder(signals({ extendedThinking: true, text: 'fix this bug' }))).toBe('deep');
    expect(pickLadder(signals({ text: 'Why does this function return undefined?' }))).toBe('code');
    expect(pickLadder(signals({ text: 'TypeError: x is not a function\n    at main (app.js:3:9)' }))).toBe('code');
    expect(pickLadder(signals({ text: 'rename utils.py please' }))).toBe('code');
    expect(pickLadder(signals({ text: 'thanks!' }))).toBe('fast');
    expect(pickLadder(signals({ text: 'hi' }))).toBe('fast');
    expect(pickLadder(signals())).toBe('default');
  });

  it('small talk is short, has no question and starts like a greeting or thanks', () => {
    expect(isSmallTalk('Good morning')).toBe(true);
    expect(isSmallTalk('hi, how are you?')).toBe(false);
    expect(isSmallTalk('explain recursion')).toBe(false);
    expect(isSmallTalk('thanks but can you write the whole essay again in a formal tone')).toBe(false);
  });

  it('every ladder entry is a registry model; Auto defaults to GPT-OSS 120B and keeps Cloudflare last', () => {
    for (const ids of Object.values(LADDERS)) for (const id of ids) expect(modelById(MODELS, id), id).not.toBeNull();
    expect(LADDERS.default[0]).toBe('groq:openai/gpt-oss-120b');
    expect(LADDERS.default.at(-1)).toMatch(/^cloudflare:/);
  });

  it('the vision ladder only has models that can see', () => {
    for (const m of ladderModels(MODELS, 'vision')) expect(m.flags.vision, m.id).toBe(true);
  });

  it('owner overrides switch models off everywhere and reorder within a group', () => {
    const reg = applyOverrides(MODELS, { 'groq:openai/gpt-oss-120b': { enabled: false }, 'groq:openai/gpt-oss-20b': { order: -1 }, junk: 5 });
    expect(modelById(reg, 'groq:openai/gpt-oss-120b')).toBeNull();
    expect(ladderModels(reg, 'default')[0].id).toBe('gemini:gemini-3.5-flash');
    expect(reg.filter((m) => m.group === 'fast').map((m) => m.id)).toEqual(['groq:openai/gpt-oss-20b', 'groq:qwen/qwen3.8-27b']);
    expect(reg.findIndex((m) => m.group === 'fast')).toBe(0);
    expect(applyOverrides(MODELS, 'nonsense')).toHaveLength(MODELS.length);
  });
});

describe('cooldowns', () => {
  beforeEach(() => _resetCooldowns());
  const now = 1_000_000_000_000;

  it('rests by kind', () => {
    expect(restFor(new ProviderError('rate', { retryAfterMs: 5_000 }), now)).toEqual({ scope: 'model', until: now + 5_000 });
    expect(restFor(new ProviderError('rate', { retryAfterMs: 3_600_000 }), now)?.until).toBe(now + RATE_MAX_MS);
    expect(restFor(new ProviderError('quota'), now)?.until).toBe(now + QUOTA_DEFAULT_MS);
    expect(restFor(new ProviderError('quota', { untilMs: now + 1_000 }), now)?.until).toBe(now + 1_000);
    expect(restFor(new ProviderError('gone'), now)?.until).toBe(now + GONE_MS);
    expect(restFor(new ProviderError('auth'), now)).toEqual({ scope: 'provider', until: now + AUTH_MS });
    expect(restFor(new ProviderError('upstream'), now)?.until).toBe(now + UPSTREAM_MS);
    for (const kind of ['timeout', 'network', 'empty', 'bad_request'] as const) expect(restFor(new ProviderError(kind), now)).toBeNull();
  });

  it('a 401 rests every model of that provider; a new rest never shortens a longer one', () => {
    noteFailure(spec('groq:openai/gpt-oss-120b'), new ProviderError('auth'), now);
    expect(isCooling(spec('groq:qwen/qwen3.8-27b'), now + 1)).toBe(true);
    expect(isCooling(spec('gemini:gemini-3.5-flash'), now + 1)).toBe(false);
    const m = spec('gemini:gemini-3.5-flash');
    noteFailure(m, new ProviderError('quota'), now);
    noteFailure(m, new ProviderError('upstream'), now);
    expect(coolingUntil(m, now)).toBe(now + QUOTA_DEFAULT_MS);
  });

  it('a spent Workers AI pool rests every Workers AI model', () => {
    noteFailure(spec('cloudflare:@cf/meta/llama-3.3-70b-instruct-fp8-fast'), new ProviderError('quota', { untilMs: now + 60_000 }), now);
    expect(isCooling(spec('cloudflare:@cf/meta/llama-3.1-8b-instruct-fast'), now + 1)).toBe(true);
  });
});

// ------------------------------------------------------------- runChat

type Script = Array<ProviderEvent | { type: 'throw'; error: ProviderError } | { type: 'hang' }>;

function fakeAdapters(scripts: Record<string, Script>, calls: string[]): Record<ProviderId, Adapter> {
  const adapter: Adapter = {
    async *stream(_env, req) {
      calls.push(req.model.id);
      for (const step of scripts[req.model.id] ?? [{ type: 'throw', error: new ProviderError('upstream') }]) {
        if (step.type === 'throw') throw step.error;
        if (step.type === 'hang') {
          await new Promise((_, reject) => req.signal.addEventListener('abort', () => reject(new Error('aborted'))));
        }
        yield step as ProviderEvent;
      }
    },
  };
  return { groq: adapter, gemini: adapter, openrouter: adapter, nvidia: adapter, cloudflare: adapter };
}

async function run(candidates: string[], scripts: Record<string, Script>, opts: { picked?: boolean; signal?: AbortSignal; firstEventMs?: number } = {}) {
  const calls: string[] = [];
  const events: RouterEvent[] = [];
  for await (const ev of runChat({}, {
    candidates: candidates.map(spec), picked: !!opts.picked,
    build: (s) => ({ model: s, system: '', messages: [{ role: 'user', text: 'q' }], maxOutputTokens: 100, reasoning: 'default', webSearch: false }),
    signal: opts.signal ?? new AbortController().signal, firstEventMs: opts.firstEventMs ?? 1_000, budgetMs: 5_000,
    adapters: fakeAdapters(scripts, calls),
  })) events.push(ev);
  return { calls, events };
}

const A = 'groq:openai/gpt-oss-120b';
const B = 'gemini:gemini-3.5-flash';
const C = 'nvidia:nvidia/nemotron-3.5-lightning-30b-a3b';
const ok = (text: string): Script => [{ type: 'text', delta: text }, { type: 'end', reason: 'stop' }];

describe('runChat', () => {
  beforeEach(() => _resetCooldowns());

  it('answers with the first model when it works', async () => {
    const { calls, events } = await run([A, B], { [A]: ok('hello') });
    expect(calls).toEqual([A]);
    expect(events.map((e) => e.type)).toEqual(['model', 'text', 'end']);
  });

  it('fails over before the first token: 429, then an empty (think-only) stream', async () => {
    const { calls, events } = await run([A, B, C], {
      [A]: [{ type: 'throw', error: new ProviderError('rate', { status: 429 }) }],
      [B]: [{ type: 'thinking', delta: 'hmm' }, { type: 'throw', error: new ProviderError('empty') }],
      [C]: ok('from C'),
    });
    expect(calls).toEqual([A, B, C]);
    const models = events.filter((e) => e.type === 'model').map((e) => (e as { spec: ModelSpec }).spec.id);
    expect(models).toEqual([B, C]);
    expect(events.at(-1)).toEqual({ type: 'end', reason: 'stop' });
    expect(isCooling(spec(A))).toBe(true);
    expect(isCooling(spec(B))).toBe(false); // an empty answer earns no rest
  });

  it('a timeout to the first event fails over', async () => {
    const { calls, events } = await run([A, B], { [A]: [{ type: 'hang' }], [B]: ok('B') }, { firstEventMs: 20 });
    expect(calls).toEqual([A, B]);
    expect(events.filter((e) => e.type === 'text')).toHaveLength(1);
  });

  it('never fails over after the first answer token: the reply ends as a partial failure', async () => {
    const { calls, events } = await run([A, B], { [A]: [{ type: 'text', delta: 'half' }, { type: 'throw', error: new ProviderError('upstream') }], [B]: ok('B') });
    expect(calls).toEqual([A]);
    expect(events.at(-1)).toMatchObject({ type: 'failed', partial: true, error: { kind: 'upstream' } });
  });

  it('a picked model is never swapped', async () => {
    const { calls, events } = await run([A], { [A]: [{ type: 'throw', error: new ProviderError('quota') }] }, { picked: true });
    expect(calls).toEqual([A]);
    expect(events).toEqual([expect.objectContaining({ type: 'failed', partial: false, spec: spec(A) })]);
  });

  it('skips resting models without a request, but tries them all when every one rests', async () => {
    noteFailure(spec(A), new ProviderError('upstream'));
    expect((await run([A, B], { [A]: ok('A'), [B]: ok('B') })).calls).toEqual([B]);
    noteFailure(spec(B), new ProviderError('upstream'));
    expect((await run([A, B], { [A]: ok('A'), [B]: ok('B') })).calls).toEqual([A]);
  });

  it('reports exhaustion when every model fails', async () => {
    const { events } = await run([A, B], {});
    expect(events.at(-1)).toMatchObject({ type: 'failed', partial: false });
  });

  it('stops quietly when the listener stops', async () => {
    const ac = new AbortController();
    const p = run([A, B], { [A]: [{ type: 'text', delta: 'x' }, { type: 'hang' }], [B]: ok('B') }, { signal: ac.signal });
    setTimeout(() => ac.abort(), 10);
    const { calls, events } = await p;
    expect(calls).toEqual([A]);
    expect(events.some((e) => e.type === 'failed')).toBe(false);
  });

  it('gives human reasons, never provider text', () => {
    expect(humanReason(new ProviderError('rate'), spec(A))).toBe('GPT-OSS 120B is busy right now.');
    expect(humanReason(new ProviderError('timeout'), spec(B))).toBe('Gemini 3.5 Flash took too long to answer.');
  });
});
