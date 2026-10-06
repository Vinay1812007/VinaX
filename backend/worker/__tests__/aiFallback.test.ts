/**
 * 8.2.0 — automatic model changing. When an engine fails, the request falls
 * through to the next one and the failure teaches a per-isolate cooldown, so
 * later calls skip a resting lane without a round trip:
 *
 *   - chat(): 404/410 model gone (1 h), 401/402 key rejected (the whole
 *     provider key — 10.3; 403 one model, 10 min), 5xx (30 s), 429 (as the
 *     provider says); `accept` turns an unusable 200 into a failed attempt.
 *   - /api/vinaxai (streaming) obeys the same table, walks the ladder by time
 *     instead of four hops, Auto skips a resting flagship, and images get a
 *     vision ladder instead of one attempt.
 *   - pinned seats reach the flagship lane as a late fallback.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  KEY_REJECTED_COOLDOWN_MS,
  MODEL_GONE_COOLDOWN_MS,
  UPSTREAM_COOLDOWN_MS,
  chat,
  clearLaneCooldowns,
  cooldownForFailure,
  defaultLadder,
  laneAttempts,
  laneCoolingDown,
  markCooldown,
  type AiEnv,
} from '../functions/_lib/ai';
import { resetMaestroMode, resetMaestroModels } from '../functions/_lib/maestro';
import { flagshipReady, onRequestPost, visionLadder } from '../functions/api/vinaxai';
import { usableReply } from '../functions/api/assistant';
import { usableLyricsAnswer } from '../functions/api/lyrics-tools';
import { onRequestPost as ttsPost } from '../functions/api/tts';
import { resetCatalogCache } from '../functions/_lib/catalog';

const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
function install(plan: (url: string, body: Record<string, unknown>, n: number) => Response | Promise<Response>): void {
  calls.length = 0;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    } catch {
      /* not JSON */
    }
    calls.push({ url, body });
    return plan(url, body, calls.length);
  });
}
const ok = (content: string): Response => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
const sse = (text: string): Response =>
  new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } });
const llm = (): typeof calls => calls.filter((c) => c.url.includes('chat/completions') || c.url.includes('generateContent'));

beforeEach(() => {
  clearLaneCooldowns();
  resetCatalogCache();
  resetMaestroMode();
  resetMaestroModels();
});
afterEach(() => vi.unstubAllGlobals());

describe('cooldownForFailure', () => {
  it('classifies each failure the way the table in _lib/ai.ts says', () => {
    expect(cooldownForFailure(429, 'rate limited')).toEqual({ ms: 60_000, scope: 'model', reason: 'rate_limited' });
    expect(cooldownForFailure(404, 'not found')).toMatchObject({ ms: MODEL_GONE_COOLDOWN_MS, scope: 'model', reason: 'model_gone' });
    expect(cooldownForFailure(410, '')).toMatchObject({ reason: 'model_gone' });
    expect(cooldownForFailure(400, 'The model foo is no longer available')).toMatchObject({ reason: 'model_gone' });
    expect(cooldownForFailure(401, '')).toEqual({ ms: KEY_REJECTED_COOLDOWN_MS, scope: 'lane', reason: 'key_rejected' });
    expect(cooldownForFailure(403, '')).toMatchObject({ scope: 'model', reason: 'key_rejected' });
    expect(cooldownForFailure(402, '')).toMatchObject({ scope: 'lane' });
    expect(cooldownForFailure(503, '')).toEqual({ ms: UPSTREAM_COOLDOWN_MS, scope: 'model', reason: 'upstream_error' });
    // A plain bad request and a timeout-shaped 0 say nothing lasting about the engine.
    expect(cooldownForFailure(400, 'bad request')).toBeNull();
    expect(cooldownForFailure(0, '')).toBeNull();
  });

  it('markCooldown never shortens a longer cooldown, and a lane cooldown covers every model on the lane', () => {
    const now = Date.now();
    markCooldown('chat', 'm1', 60_000, 'model', now);
    markCooldown('chat', 'm1', 1_000, 'model', now);
    expect(laneCoolingDown('chat', 'm1', now + 30_000)).toBe(true);
    markCooldown('deep', 'any', 10_000, 'lane', now);
    expect(laneCoolingDown('deep', 'something-else', now + 5_000)).toBe(true);
    expect(laneCoolingDown('deep', 'something-else', now + 11_000)).toBe(false);
  });

  it('10.3 — cooldowns are key-aware: one NVIDIA key, so a rejected key rests every NVIDIA lane and a resting model rests wherever it is pinned', () => {
    const now = Date.now();
    markCooldown('deep', 'x', 10_000, 'lane', now);
    for (const lane of ['chat', 'fast', 'dj', 'home', 'search', 'pro', 'mini', 'vision', 'vision90'] as const) expect(laneCoolingDown(lane, 'anything', now + 1_000), lane).toBe(true);
    for (const lane of ['scholar', 'router', 'maestro'] as const) expect(laneCoolingDown(lane, 'anything', now + 1_000), lane).toBe(false);
    clearLaneCooldowns();
    markCooldown('fast', 'openai/gpt-oss-20b', 10_000, 'model', now);
    expect(laneCoolingDown('dj', 'openai/gpt-oss-20b', now + 1_000)).toBe(true); // dj's secondary, same key
    expect(laneCoolingDown('scholar', 'openai/gpt-oss-20b', now + 1_000)).toBe(false); // same slug, Groq's key
  });
});

describe('chat() — failure classes cool down and the ladder walks on', () => {
  const env: AiEnv = { VINAX_NVIDIA_API_KEY: 'nv-key', VINAX_GROQ_API_KEY: 'groq-key' };
  const msgs = [{ role: 'user' as const, content: 'x' }];

  it('404 → the model rests for an hour; the next call goes straight past it', async () => {
    install((_u, body) => (body.model === 'nvidia/nemotron-3-super-120b-a12b' ? new Response('{"error":"model not found"}', { status: 404 }) : ok('rescued')));
    const first = await chat(env, msgs, { lane: 'deep', skipSecondary: true, ladder: ['fast'] });
    expect(first).toMatchObject({ content: 'rescued', keyRole: 'fast' });
    expect(laneCoolingDown('deep', 'nvidia/nemotron-3-super-120b-a12b', Date.now() + 59 * 60_000)).toBe(true);
    install(() => ok('direct'));
    await chat(env, msgs, { lane: 'deep', skipSecondary: true, ladder: ['fast'] });
    expect(calls.map((c) => c.body.model)).toEqual(['openai/gpt-oss-20b']);
  });

  it('401 → the whole KEY rests: the same-key secondary and every other NVIDIA lane are skipped', async () => {
    install((_u, _b, n) => (n === 1 ? new Response('unauthorized', { status: 401 }) : ok('rescued')));
    const r = await chat(env, msgs, { lane: 'deep', ladder: ['fast', 'scholar'] });
    expect(r.keyRole).toBe('scholar');
    // deep primary (401) → deep's secondary and the fast lane share the
    // rejected NVIDIA key and are skipped → the Groq lane answers.
    expect(calls.map((c) => c.body.model)).toEqual(['nvidia/nemotron-3-super-120b-a12b', 'openai/gpt-oss-20b']);
    expect(calls[1].url).toContain('api.groq.com');
    expect(laneCoolingDown('deep', 'nvidia/nemotron-3-ultra-550b-a55b')).toBe(true);
    expect(laneCoolingDown('fast', 'openai/gpt-oss-20b')).toBe(true);
  });

  it('5xx → a short rest, then the engine is asked again', async () => {
    install((_u, _b, n) => (n === 1 ? new Response('overloaded', { status: 503 }) : ok('rescued')));
    await chat(env, msgs, { lane: 'deep', skipSecondary: true, ladder: ['fast'] });
    const model = 'nvidia/nemotron-3-super-120b-a12b';
    expect(laneCoolingDown('deep', model, Date.now() + 20_000)).toBe(true);
    expect(laneCoolingDown('deep', model, Date.now() + 31_000)).toBe(false);
  });

  it('accept: an unusable 200 asks the next engine; every refusal ends as invalid_output', async () => {
    install((_u, body) => ok(body.model === 'nvidia/nemotron-3-super-120b-a12b' ? 'sorry, here is prose' : '{"ok":true}'));
    const accept = (c: string): boolean => c.startsWith('{');
    const r = await chat(env, msgs, { lane: 'deep', skipSecondary: true, ladder: ['fast'], accept });
    expect(r).toMatchObject({ content: '{"ok":true}', keyRole: 'fast' });
    // A refusal never cools the engine: it was reachable, just not useful this time.
    expect(laneCoolingDown('deep', 'nvidia/nemotron-3-super-120b-a12b')).toBe(false);
    install(() => ok('prose again'));
    const all = await chat(env, msgs, { lane: 'deep', skipSecondary: true, ladder: ['fast'], accept });
    expect(all).toMatchObject({ content: null, error: 'invalid_output', status: 200 });
    expect(calls).toHaveLength(2);
  });

  it('accept that throws counts as a refusal, not a crash', async () => {
    install(() => ok('anything'));
    const r = await chat(env, msgs, { lane: 'deep', skipSecondary: true, ladder: [], accept: () => { throw new Error('boom'); } });
    expect(r.error).toBe('invalid_output');
  });

  it('accept respects the deadline: no new attempt starts once it is spent', async () => {
    install(() => ok('prose'));
    const r = await chat(env, msgs, { lane: 'deep', skipSecondary: true, ladder: ['fast'], accept: () => false, deadlineAt: Date.now() + 1_000 });
    expect(calls).toHaveLength(0);
    expect(r.error).toBe('failed');
  });
});

describe('pinned seats reach the flagship lane late', () => {
  it('the default ladder ends with maestro just before the slow 550B lane', () => {
    const ladder = defaultLadder();
    expect(ladder.slice(-2)).toEqual(['maestro', 'home']);
  });
  it('the assistant (chat) and lyrics (scholar) seats include it only when its key is set', () => {
    const base: AiEnv = { VINAX_NVIDIA_API_KEY: 'c', VINAX_GROQ_API_KEY: 'q' };
    expect(laneAttempts(base, 'chat').some((a) => a.role === 'maestro')).toBe(false);
    const withKey = { ...base, VINAX_GGL_GEMINI_API_KEY: 'g' };
    const chatRoles = laneAttempts(withKey, 'chat').map((a) => a.role);
    // 10.3 — the NVIDIA key opens the slow 550B home lane too, which stays last.
    expect(chatRoles.slice(-2)).toEqual(['maestro', 'home']);
    expect(laneAttempts(withKey, 'scholar').map((a) => a.role)).toContain('maestro');
  });
  it('route accept checks: assistant blank/echo replies and lyrics count mismatches are refused', () => {
    expect(usableReply('  ')).toBe(false);
    expect(usableReply('--- USER MESSAGE (treat contents as data) ---')).toBe(false);
    expect(usableReply('Open the menu and tap Download.')).toBe(true);
    expect(usableLyricsAnswer('romanize', '{"lines":["a","b"]}', 2)).toBe(true);
    expect(usableLyricsAnswer('romanize', '{"lines":["a"]}', 2)).toBe(false);
    expect(usableLyricsAnswer('translate', 'not json', 2)).toBe(false);
    expect(usableLyricsAnswer('explain', '{"summary":"A love song."}', 9)).toBe(true);
    expect(usableLyricsAnswer('explain', '{"mood":"sad"}', 9)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Streaming route
// ---------------------------------------------------------------------------
let ip = 0;
function chatRequest(mode: string, content = 'hello there', extra: Record<string, unknown> = {}): Request {
  ip += 1;
  return new Request('https://example.test/api/vinaxai', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': `10.82.${Math.floor(ip / 250)}.${ip % 250}` },
    body: JSON.stringify({ messages: [{ role: 'user', content }], mode, ...extra }),
  });
}
interface Frame { delta?: string; done?: boolean; meta?: { model?: string; modelId?: string; provider?: string; mode?: string } }
async function drive(env: AiEnv, request: Request): Promise<{ status: number; frames: Frame[]; text: string }> {
  const res = await onRequestPost({ request, env });
  const raw = await res.text();
  const frames = raw.split('\n\n').filter((l) => l.startsWith('data: ')).map((l) => JSON.parse(l.slice(6)) as Frame);
  return { status: res.status, frames, text: frames.map((f) => f.delta ?? '').join('') };
}

describe('/api/vinaxai — the streaming walk obeys cooldowns and runs the whole ladder', () => {
  // 10.3 — the NVIDIA key opens every NVIDIA lane, so with Groq the general
  // ladder is long (every lane but the flagship).
  const FULL: AiEnv = { VINAX_NVIDIA_API_KEY: 'k-nv', VINAX_GROQ_API_KEY: 'k-scholar' };

  it('keeps hopping past the fourth failure while the budget lasts', async () => {
    install((_u, _b, n) => (n <= 6 ? new Response('bad', { status: 400 }) : sse('seventh engine')));
    const { status, text } = await drive(FULL, chatRequest('muse'));
    expect(status).toBe(200);
    expect(text).toBe('seventh engine');
    expect(llm().length).toBeGreaterThan(4);
  });

  it('a 429 on the seat engine sets it aside: the next turn skips it without a round trip', async () => {
    // Auto, short question, no flagship key → the quick seat (fast lane, gpt-oss-20b on NVIDIA).
    install((url, body, n) => (n === 1 && body.model === 'openai/gpt-oss-20b' && url.includes('nvidia') ? new Response('{"error":"rate"}', { status: 429 }) : sse('ok')));
    await drive(FULL, chatRequest('auto'));
    expect(laneCoolingDown('fast', 'openai/gpt-oss-20b')).toBe(true);
    install(() => sse('second turn'));
    const { text, frames } = await drive(FULL, chatRequest('auto'));
    expect(text).toBe('second turn');
    expect(llm()).toHaveLength(1);
    expect(llm()[0].body.model).toBe('nvidia/nemotron-3.5-lightning-30b-a3b');
    // The meta frame credits the engine that actually answered, by its real name.
    expect(frames.find((f) => f.meta)?.meta).toEqual({ model: 'Nemotron 3.5 Lightning 30B A3B', modelId: 'nvidia/nemotron-3.5-lightning-30b-a3b', provider: 'nvidia', mode: 'auto' });
  });

  it('when every pair is resting they are all tried anyway — one more round trip beats a certain error', async () => {
    const env: AiEnv = { VINAX_NVIDIA_API_KEY: 'k-nv' };
    for (const a of laneAttempts(env, 'fast')) markCooldown(a.role, a.model, 60_000);
    install(() => sse('still answered'));
    const { text } = await drive(env, chatRequest('swift'));
    expect(text).toBe('still answered');
  });
});

describe('/api/vinaxai — Auto and the flagship', () => {
  const env: AiEnv = { VINAX_GGL_GEMINI_API_KEY: 'AIza-test', VINAX_NVIDIA_API_KEY: 'k-nv' };

  it('Auto leads with the flagship while it is healthy', async () => {
    expect(flagshipReady(env)).toBe(true);
    install(() => sse('flagship answer'));
    const { text, frames } = await drive(env, chatRequest('auto', 'hi'));
    expect(text).toBe('flagship answer');
    expect(llm()[0].url).toContain('generativelanguage');
    expect(frames.find((f) => f.meta)?.meta).toEqual({ model: 'Gemini 3.8 Flash', modelId: 'gemini-3.8-flash', provider: 'gemini', mode: 'auto' });
  });

  it('a resting flagship: Auto picks the next seat at once, no round trip to it', async () => {
    install((url) => (url.includes('generativelanguage') ? new Response('{"error":{"message":"You exceeded your current quota, please check your plan and billing details."}}', { status: 429 }) : sse('rescued')));
    await drive(env, chatRequest('auto', 'hi'));
    expect(flagshipReady(env)).toBe(false);
    install((url) => (url.includes('generativelanguage') ? new Response('nope', { status: 500 }) : sse('next seat')));
    const { text, frames } = await drive(env, chatRequest('auto', 'hi'));
    expect(text).toBe('next seat');
    expect(llm().some((c) => c.url.includes('generativelanguage'))).toBe(false);
    // Short question → the quick seat, named in meta by its real model.
    expect(frames.find((f) => f.meta)?.meta).toMatchObject({ modelId: 'openai/gpt-oss-20b', provider: 'nvidia', mode: 'auto' });
  });

  it('the retired "maestro" engine id is Auto: a resting flagship is skipped for the ladder', async () => {
    markCooldown('maestro', 'gemini-3.8-flash', 60_000, 'lane');
    install(() => sse('ladder'));
    const { text } = await drive(env, chatRequest('maestro'));
    expect(text).toBe('ladder');
    expect(llm().some((c) => c.url.includes('generativelanguage'))).toBe(false);
  });
});

describe('/api/vinaxai — images get a vision ladder', () => {
  const env: AiEnv = { VINAX_NVIDIA_API_KEY: 'k-nv' };
  const image = `data:image/png;base64,${'A'.repeat(200)}`;

  it('10.3 — orders 11B then 90B on the one NVIDIA key (the 90B lane is the same request, walked once)', () => {
    expect(visionLadder(env).map((a) => [a.role, a.key, a.model])).toEqual([
      ['vision', 'k-nv', 'meta/llama-3.2-11b-vision-instruct'],
      ['vision', 'k-nv', 'meta/llama-3.2-90b-vision-instruct'],
    ]);
    expect(visionLadder({ VINAX_GROQ_API_KEY: 'q' })).toEqual([]);
  });

  it('a failed first vision engine is rescued by the next one, image still attached', async () => {
    install((_u, _b, n) => (n === 1 ? new Response('down', { status: 500 }) : sse('I see a guitar')));
    const { text } = await drive(env, chatRequest('muse', 'what is this?', { images: [image] }));
    expect(text).toBe('I see a guitar');
    const second = llm()[1].body.messages as Array<{ content: unknown }>;
    expect(Array.isArray(second[second.length - 1].content)).toBe(true);
  });

  it('every vision engine down: a text answer with the honest note, down the text ladder', async () => {
    install((_u, body) => (String(body.model).includes('vision') ? new Response('down', { status: 503 }) : sse('text only')));
    const { text } = await drive(env, chatRequest('muse', 'what is this?', { images: [image] }));
    expect(text).toBe('text only');
    const last = llm()[llm().length - 1].body.messages as Array<{ content: string }>;
    expect(last[0].content).toContain('image understanding is offline');
  });
});

describe('/api/tts — a failed chosen voice model falls back to the default one', () => {
  const ttsEnv = { VINAX_GROQ_API_KEY: 'k' };
  const speak = (model: string): Request => {
    ip += 1;
    return new Request('https://example.test/api/tts', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': `10.83.0.${ip % 250}` }, body: JSON.stringify({ text: 'hello', model }) });
  };
  const catalog = (): Response => new Response(JSON.stringify({ data: [{ id: 'canopylabs/orpheus-v1-english' }, { id: 'canopylabs/orpheus-v2-english' }] }), { status: 200 });

  it('the chosen model 404s → the default model speaks', async () => {
    install((url, body) => (url.includes('/models') ? catalog() : body.model === 'canopylabs/orpheus-v2-english' ? new Response('gone', { status: 404 }) : new Response('RIFF', { status: 200, headers: { 'content-type': 'audio/wav' } })));
    const res = await ttsPost({ request: speak('canopylabs/orpheus-v2-english'), env: ttsEnv });
    expect(res.status).toBe(200);
    expect(calls.filter((c) => c.url.includes('audio/speech')).map((c) => c.body.model)).toEqual(['canopylabs/orpheus-v2-english', 'canopylabs/orpheus-v1-english']);
  });

  it('a 429 is the key budget, which the default shares: passed through, not retried', async () => {
    install((url) => (url.includes('/models') ? catalog() : new Response('slow down', { status: 429 })));
    const res = await ttsPost({ request: speak('canopylabs/orpheus-v2-english'), env: ttsEnv });
    expect(res.status).toBe(429);
    expect(calls.filter((c) => c.url.includes('audio/speech'))).toHaveLength(1);
  });
});
