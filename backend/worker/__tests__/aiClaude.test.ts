/**
 * VinaX AI — Claude (provider `anthropic`): the Messages API adapter, the
 * thinking levels it gets, and the lock: only the accounts in
 * claudeAccess.ts may pick it; everyone else sees it locked and the chat
 * refuses it. Auto never uses it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { anthropic, anthropicBody, ANTHROPIC_URL, FALLBACK_BETA } from '../functions/_lib/ai/adapters/anthropic';
import { ADAPTERS, providerConfigured } from '../functions/_lib/ai/adapters';
import { CLAUDE_EMAILS, claudeEmailAllowed, isLockedModel } from '../functions/_lib/ai/claudeAccess';
import { ProviderError } from '../functions/_lib/ai/errors';
import { APPROVED_MODELS, LADDERS, MODELS, modelById } from '../functions/_lib/ai/models';
import { levelsOf, specAtLevel } from '../functions/_lib/ai/thinking';
import { onRequestPost as postChat, tailStop } from '../functions/api/ai/chat';
import { onRequestGet as getModels } from '../functions/api/ai/models';
import { issueSession } from '../functions/_lib/googleAuth';
import { resetSettingsMemo } from '../functions/_lib/settings';
import { _resetRateLimitsForTests } from '../functions/_lib/ratelimit';
import { _resetCooldowns } from '../functions/_lib/ai/cooldown';
import type { AiEnv, ChatRequest, ModelSpec, ProviderEvent } from '../functions/_lib/ai/types';
import { DB_ENV, fakeDb } from './helpers/fakeDb';
import { anthropicSse, openAiSse, readEvents, sseResponse } from './helpers/aiStreams';

const HAIKU = 'anthropic:claude-haiku-5-5';
const HAIKU_45 = 'anthropic:claude-haiku-4-5';
/** Haiku only (the owner's choice, 2026-11-12); Claude 3.5 Haiku and 3 Haiku are retired at Anthropic. */
const CLAUDE_IDS = [HAIKU, HAIKU_45];
const OWNER = 'sirimillavinay56@gmail.com';
const spec = (id: string): ModelSpec => modelById(MODELS, id)!;
const req = (id: string, over: Partial<ChatRequest> = {}): ChatRequest => ({
  model: spec(id), system: 'SYSTEM', messages: [{ role: 'user', text: 'hi' }], maxOutputTokens: 4_096,
  reasoning: 'default', webSearch: false, signal: new AbortController().signal, ...over,
});
const KEY_ENV: AiEnv = { ANTHROPIC_API_KEY: 'sk-ant-test' };

async function collect(r: ChatRequest, env: AiEnv = KEY_ENV): Promise<ProviderEvent[]> {
  const out: ProviderEvent[] = [];
  for await (const ev of anthropic.stream(env, r)) out.push(ev);
  return out;
}
const joined = (events: ProviderEvent[], type: 'text' | 'thinking') => events.filter((e) => e.type === type).map((e) => (e as { delta: string }).delta).join('');

function stubFetch(res: () => Response) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return res();
  }));
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('the registry', () => {
  it('has Claude Haiku 5.5 and 4.5 only, approved, in their own group, never in a ladder', () => {
    expect(MODELS.filter((m) => m.provider === 'anthropic').map((m) => m.id)).toEqual(CLAUDE_IDS);
    expect([...APPROVED_MODELS].filter((id) => id.startsWith('anthropic:'))).toEqual(CLAUDE_IDS);
    for (const id of CLAUDE_IDS) {
      expect(APPROVED_MODELS.has(id), id).toBe(true);
      expect(spec(id).group).toBe('claude');
      expect(isLockedModel(spec(id))).toBe(true);
    }
    for (const [name, ids] of Object.entries(LADDERS)) expect(ids.filter((id) => id.startsWith('anthropic:')), name).toEqual([]);
    expect(MODELS.filter((m) => m.provider !== 'anthropic').some(isLockedModel)).toBe(false);
  });

  it('is configured only with ANTHROPIC_API_KEY', () => {
    expect(providerConfigured({}, 'anthropic')).toBe(false);
    expect(providerConfigured({ ANTHROPIC_API_KEY: '  ' }, 'anthropic')).toBe(false);
    expect(providerConfigured(KEY_ENV, 'anthropic')).toBe(true);
    expect(ADAPTERS.anthropic.wire).toBe('anthropic');
  });

  it('every Claude model has all four thinking levels; on Haiku 5.5 each is a real effort', () => {
    for (const id of CLAUDE_IDS) expect(levelsOf(spec(id))).toEqual(['fast', 'standard', 'extended', 'max']);
    const effort = (level: 'fast' | 'standard' | 'extended' | 'max') => (anthropicBody(req(HAIKU, { model: specAtLevel(spec(HAIKU), level) })).output_config as { effort: string }).effort;
    expect([effort('fast'), effort('standard'), effort('extended'), effort('max')]).toEqual(['low', 'medium', 'high', 'max']);
    expect(specAtLevel(spec(HAIKU), 'max').maxOutput).toBe(65_536);
    // The level's effort replaces the default; adaptive thinking stays.
    expect(anthropicBody(req(HAIKU, { model: specAtLevel(spec(HAIKU), 'extended') })).thinking).toEqual({ type: 'adaptive', display: 'summarized' });
  });

  it('Haiku 4.5 thinks by token budget (no effort): none at Fast, then 4K, 16K and 32K under max_tokens', () => {
    const at = (level: 'fast' | 'standard' | 'extended' | 'max') => {
      const model = specAtLevel(spec(HAIKU_45), level);
      return anthropicBody(req(HAIKU_45, { model, maxOutputTokens: model.maxOutput }));
    };
    const fast = at('fast');
    expect(fast).not.toHaveProperty('thinking');
    expect(fast).not.toHaveProperty('output_config');
    expect(fast).toMatchObject({ model: 'claude-haiku-4-5', max_tokens: 32_768 });
    expect(at('standard')).toMatchObject({ thinking: { type: 'enabled', budget_tokens: 4_096 }, max_tokens: 32_768 });
    expect(at('extended')).toMatchObject({ thinking: { type: 'enabled', budget_tokens: 16_384 }, max_tokens: 32_768 });
    expect(at('max')).toMatchObject({ thinking: { type: 'enabled', budget_tokens: 32_768 }, max_tokens: 64_000 });
    for (const level of ['standard', 'extended', 'max'] as const) {
      const b = at(level) as { thinking: { budget_tokens: number }; max_tokens: number };
      expect(b.thinking.budget_tokens, level).toBeLessThan(b.max_tokens);
      expect(b).not.toHaveProperty('output_config');
    }
  });

  it('a small reply keeps its room: the budget fits under max_tokens, or thinking is left out', () => {
    const extended = specAtLevel(spec(HAIKU_45), 'extended');
    // Asked for 2,000 tokens: the budget goes on top, under the model's ceiling.
    expect(anthropicBody(req(HAIKU_45, { model: extended, maxOutputTokens: 2_000 }))).toMatchObject({ max_tokens: 18_384, thinking: { type: 'enabled', budget_tokens: 16_384 } });
    // A ceiling with no room for a budget of at least 1,024: no thinking at all.
    const tight = { ...extended, maxOutput: 1_500 };
    const body = anthropicBody(req(HAIKU_45, { model: tight, maxOutputTokens: 1_500 }));
    expect(body).not.toHaveProperty('thinking');
    expect(body.max_tokens).toBe(1_500);
  });
});

describe('the Claude adapter', () => {
  it('sends the native Messages API request: key header, version, system on top, images first, no temperature', async () => {
    const calls = stubFetch(() => sseResponse(anthropicSse('Hello there.')));
    const r = req(HAIKU, {
      temperature: 0.4,
      messages: [
        { role: 'user', text: 'What is this?', images: [{ mime: 'image/png', data: 'iVBOR' }] },
        { role: 'assistant', text: 'A cat.' },
        { role: 'user', text: 'Sure?' },
      ],
    });
    await collect(r);
    expect(calls[0].url).toBe(ANTHROPIC_URL);
    const h = calls[0].init.headers as Record<string, string>;
    expect(h['x-api-key']).toBe('sk-ant-test');
    expect(h['anthropic-version']).toBe('2023-06-01');
    // Haiku has no server-side fallback, so no beta header and no `fallbacks`.
    expect(h['anthropic-beta']).toBeUndefined();
    expect(h.authorization).toBeUndefined();
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toMatchObject({ model: 'claude-haiku-5-5', system: 'SYSTEM', stream: true, max_tokens: 4_096, thinking: { type: 'adaptive', display: 'summarized' }, output_config: { effort: 'medium' } });
    expect(body).not.toHaveProperty('fallbacks');
    expect(body).not.toHaveProperty('temperature');
    expect(body.messages[0].content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBOR' } },
      { type: 'text', text: 'What is this?' },
    ]);
    expect(body.messages[1]).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'A cat.' }] });
  });

  it('a model given `fallbacks` (none now) gets the server-side fallback beta header', async () => {
    const calls = stubFetch(() => sseResponse(anthropicSse('Hi.')));
    const withFallback = { ...spec(HAIKU), params: { ...spec(HAIKU).params, fallbacks: 'default' } };
    await collect(req(HAIKU, { model: withFallback }));
    expect((calls[0].init.headers as Record<string, string>)['anthropic-beta']).toBe(FALLBACK_BETA);
    expect(JSON.parse(String(calls[0].init.body)).fallbacks).toBe('default');
  });

  it('reads thinking and text deltas however the bytes are cut, with usage and the stop reason', async () => {
    for (const size of [1, 5, 64, 10_000]) {
      stubFetch(() => sseResponse(anthropicSse('Yaman is an evening raga.', { thinking: 'Recall Hindustani ragas.', input: 30, output: 11 }), size));
      const events = await collect(req(HAIKU));
      expect(joined(events, 'thinking'), `size ${size}`).toBe('Recall Hindustani ragas.');
      expect(joined(events, 'text'), `size ${size}`).toBe('Yaman is an evening raga.');
      expect(events.slice(-2)).toEqual([{ type: 'usage', input: 30, output: 11 }, { type: 'end', reason: 'stop' }]);
    }
  });

  it('max_tokens is a length stop; a refusal is a content filter, even with no text', async () => {
    stubFetch(() => sseResponse(anthropicSse('Partial', { stop: 'max_tokens' })));
    expect((await collect(req(HAIKU))).at(-1)).toEqual({ type: 'end', reason: 'length' });
    stubFetch(() => sseResponse(anthropicSse('', { stop: 'refusal' })));
    expect(await collect(req(HAIKU))).toEqual([{ type: 'end', reason: 'content_filter' }]);
  });

  it('a stream with no answer text is empty', async () => {
    stubFetch(() => sseResponse(anthropicSse('', { thinking: 'Hmm.' })));
    await expect(collect(req(HAIKU))).rejects.toMatchObject({ kind: 'empty' });
  });

  it('classifies HTTP failures and mid-stream error events', async () => {
    stubFetch(() => new Response(JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }), { status: 429, headers: { 'retry-after': '12' } }));
    await expect(collect(req(HAIKU))).rejects.toMatchObject({ kind: 'rate', retryAfterMs: 12_000 });
    stubFetch(() => new Response('{}', { status: 401 }));
    await expect(collect(req(HAIKU))).rejects.toMatchObject({ kind: 'auth' });
    const overloaded = `event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 3 } } })}\n\nevent: error\ndata: ${JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } })}\n\n`;
    stubFetch(() => sseResponse(overloaded));
    const err = await collect(req(HAIKU)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ kind: 'upstream', status: 529 });
  });

  it('without a key it never calls out', async () => {
    const calls = stubFetch(() => sseResponse(anthropicSse('x')));
    await expect(collect(req(HAIKU), {})).rejects.toMatchObject({ kind: 'not_configured' });
    expect(calls).toHaveLength(0);
  });

  it('a reply too large to parse that hit max_tokens is still a length stop', () => {
    expect(tailStop(anthropicSse('x', { stop: 'max_tokens' }))).toBe('length');
    expect(tailStop(anthropicSse('x'))).toBe('end');
  });
});

describe('who may use Claude', () => {
  it('only the owner’s email, any case or spacing', () => {
    expect([...CLAUDE_EMAILS]).toEqual([OWNER]);
    expect(claudeEmailAllowed(OWNER)).toBe(true);
    expect(claudeEmailAllowed(' SirimillaVinay56@Gmail.com ')).toBe(true);
    expect(claudeEmailAllowed('someone@gmail.com')).toBe(false);
    expect(claudeEmailAllowed('sirimillavinay56@gmail.com.evil.test')).toBe(false);
    expect(claudeEmailAllowed(null)).toBe(false);
  });
});

const BASE = { GOOGLE_CLIENT_ID: 'x.apps.googleusercontent.com', AUTH_SECRET: 'auth-secret', ...DB_ENV };
const ENV = { ...BASE, GROQ_API_KEY: 'gsk_test', ANTHROPIC_API_KEY: 'sk-ant-test' };
let ip = 0;
let pending: Array<Promise<unknown>> = [];
const settle = async () => { await Promise.all(pending); pending = []; };

/** Claude answers from api.anthropic.com; everything else (titles, Auto) in OpenAI's shape. */
const upstream = (url: string) => (url.startsWith(ANTHROPIC_URL) ? sseResponse(anthropicSse('Namaste from Claude.', { thinking: 'Greet back.' })) : sseResponse(openAiSse('Short title')));

function seed() {
  return fakeDb({
    accounts: [{ id: '1001', name: 'Vinay', email: OWNER, email_verified: false }, { id: '2002', name: 'Bo', email: 'bo@gmail.com', email_verified: true }],
    settings: [{ key: 'vinax-ai', value: { enabled: true }, updated_at: '2026-11-12T00:00:00Z', updated_by: 'owner' }],
  }, upstream);
}

async function chat(sub: string, body: Record<string, unknown>): Promise<Response> {
  const token = await issueSession(ENV, sub);
  const request = new Request('https://www.vinaxmusic.online/api/ai/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': `203.0.113.${++ip % 250}`, authorization: `Bearer ${token}` },
    body: JSON.stringify({ conversationId: null, content: [{ type: 'text', text: 'Namaste' }], timezone: 'Asia/Kolkata', locale: 'en-IN', passthrough: true, ...body }),
  });
  return postChat({ request, env: ENV as never, waitUntil: (p) => { pending.push(p); } });
}

async function models(sub: string | null): Promise<Array<{ id: string; available: boolean; reason?: string; locked?: boolean; group: string }>> {
  const token = sub ? await issueSession(ENV, sub) : null;
  const res = await getModels({ request: new Request('https://www.vinaxmusic.online/api/ai/models', { headers: { 'cf-connecting-ip': `198.51.100.${++ip % 250}`, ...(token ? { authorization: `Bearer ${token}` } : {}) } }), env: ENV as never });
  return ((await res.json()) as { models: Array<{ id: string; available: boolean; reason?: string; locked?: boolean; group: string }> }).models;
}

describe('the lock', () => {
  beforeEach(() => {
    resetSettingsMemo();
    _resetRateLimitsForTests();
    _resetCooldowns();
    pending = [];
  });

  it('the picker lists Claude for everyone, locked unless the account is the owner’s', async () => {
    seed();
    const claudeOf = (list: Awaited<ReturnType<typeof models>>) => list.filter((m) => m.group === 'claude');
    for (const sub of ['2002', null]) {
      const shown = claudeOf(await models(sub));
      expect(shown.map((m) => m.id).sort()).toEqual([...CLAUDE_IDS].sort());
      for (const m of shown) expect(m).toMatchObject({ available: false, reason: 'locked', locked: true });
    }
    for (const m of claudeOf(await models('1001'))) {
      expect(m.available).toBe(true);
      expect(m).not.toHaveProperty('locked');
      expect(m).not.toHaveProperty('reason');
    }
    // Other models are not locked for anyone.
    expect((await models('2002')).filter((m) => m.group !== 'claude').some((m) => m.locked)).toBe(false);
  });

  it('the chat refuses Claude to anyone else, before calling Anthropic', async () => {
    const fake = seed();
    const res = await chat('2002', { mode: 'model', model: HAIKU });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'model_locked' });
    expect(fake.calls.some((c) => c.table === 'ai_messages')).toBe(false);
    expect((vi.mocked(fetch).mock.calls as Array<[string]>).some(([u]) => String(u).startsWith(ANTHROPIC_URL))).toBe(false);
  });

  it('the owner gets Claude’s own stream through, read as wire "anthropic", and the reply is saved', async () => {
    const fake = seed();
    const res = await chat('1001', { mode: 'model', model: HAIKU, thinking: 'extended' });
    expect(res.status).toBe(200);
    const events = await readEvents(res);
    await settle();
    const meta = events.find((e) => e.event === 'meta')!.data as { wire: string; model: { id: string; provider: string }; thinking: { used: string } };
    expect(meta.wire).toBe('anthropic');
    expect(meta.model).toMatchObject({ id: HAIKU, provider: 'Anthropic' });
    expect(meta.thinking.used).toBe('extended');
    expect(events.filter((e) => e.event === 'text').map((e) => e.data.delta).join('')).toBe('Namaste from Claude.');
    expect(events.filter((e) => e.event === 'thinking').map((e) => e.data.delta).join('')).toBe('Greet back.');
    const sent = (vi.mocked(fetch).mock.calls as Array<[string, RequestInit]>).find(([u]) => String(u).startsWith(ANTHROPIC_URL))!;
    expect(JSON.parse(String(sent[1].body)).output_config).toEqual({ effort: 'high' });
    const saved = fake.rows('ai_messages').find((r) => r.role === 'assistant')!;
    expect(saved).toMatchObject({ model_id: HAIKU, provider: 'anthropic', thinking: 'Greet back.' });
    expect(saved.content).toEqual([{ type: 'text', text: 'Namaste from Claude.' }]);
  });

  it('Auto never answers with Claude, even for the owner', async () => {
    seed();
    const res = await chat('1001', { mode: 'auto' });
    const events = await readEvents(res);
    await settle();
    const meta = events.find((e) => e.event === 'meta')!.data as { model: { id: string } };
    expect(meta.model.id.startsWith('anthropic:')).toBe(false);
    expect((vi.mocked(fetch).mock.calls as Array<[string]>).some(([u]) => String(u).startsWith(ANTHROPIC_URL))).toBe(false);
  });
});
