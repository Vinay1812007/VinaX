/**
 * 11.0 — audit sweep of the AI feature endpoints. Two defects, each pinned here:
 *
 *   1. chat() attached the NVIDIA-only `chat_template_kwargs` switch by model
 *      name alone, so a matching model name on another provider's host carried
 *      a field that host rejects or ignores. The switch now travels on the
 *      NVIDIA base only.
 *   2. The assistant, lyrics tools, DJ and AI playlist endpoints answered 500
 *      when the upstream engines were rate limited (or every lane was resting
 *      after a 429). They now answer 429, the house convention, so a client can
 *      say "busy, try again shortly". Every other failure keeps its 500 JSON
 *      envelope.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chat, clearLaneCooldowns, resetAiControlsCache, type AiEnv } from '../functions/_lib/ai';
import { onRequestPost as assistantPost } from '../functions/api/assistant';
import { onRequestPost as lyricsPost } from '../functions/api/lyrics-tools';
import { onRequestPost as djPost } from '../functions/api/dj';
import { onRequestPost as playlistPost } from '../functions/api/playlist';

const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
/** Stub fetch: every chat-completions call gets `llm()`; anything else (a
 * catalogue or config read) gets an empty list. */
function install(llm: () => Response): void {
  calls.length = 0;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.includes('chat/completions')) return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    } catch {
      /* not JSON */
    }
    calls.push({ url, body });
    return llm();
  });
}
const ok = (content: string): Response => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
const rateLimited = (): Response => new Response(JSON.stringify({ error: { message: 'Rate limit exceeded. Please try again in 20s.' } }), { status: 429, headers: { 'content-type': 'application/json' } });
const broken = (): Response => new Response('upstream exploded', { status: 500 });
const blank = (): Response => ok('');

let ip = 0;
const post = (path: string, body: unknown): Request => {
  ip += 1;
  return new Request(`https://x.test${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': `10.77.${Math.floor(ip / 250)}.${ip % 250}` }, body: JSON.stringify(body) });
};
const env: AiEnv = { NVIDIA_API_KEY: 'nv-key' };
const POOL = [
  { id: 'p1', title: 'Samajavaragamana', artist: 'Sid Sriram', language: 'telugu' },
  { id: 'p2', title: 'Butta Bomma', artist: 'Armaan Malik', language: 'telugu' },
  { id: 'p3', title: 'Ramuloo Ramulaa', artist: 'Anurag Kulkarni', language: 'telugu' },
];

beforeEach(() => {
  clearLaneCooldowns();
  resetAiControlsCache();
});
afterEach(() => vi.unstubAllGlobals());

describe('chat() keeps the NVIDIA-only reasoning switch on the NVIDIA base', () => {
  const messages = [{ role: 'user' as const, content: 'hi' }];
  const solo = { ladder: [], skipSecondary: true };

  it('does not send chat_template_kwargs to the OpenRouter host for a matching model name', async () => {
    install(() => ok('hello'));
    const r = await chat({ OPENROUTER_API_KEY: 'or-key' }, messages, { lane: 'router', model: 'qwen/qwen3-coder:free', ...solo });
    expect(r.content).toBe('hello');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('openrouter.ai');
    expect(calls[0].body.model).toBe('qwen/qwen3-coder:free');
    expect(calls[0].body).not.toHaveProperty('chat_template_kwargs');
  });

  it('does not send chat_template_kwargs to the OpenRouter host for the nemotron free variants either', async () => {
    install(() => ok('hello'));
    await chat({ OPENROUTER_API_KEY: 'or-key' }, messages, { lane: 'router', model: 'nvidia/nemotron-3-nano-30b-a3b:free', ...solo });
    expect(calls[0].url).toContain('openrouter.ai');
    expect(calls[0].body).not.toHaveProperty('chat_template_kwargs');
  });

  it('does not send chat_template_kwargs to the Groq host', async () => {
    install(() => ok('hello'));
    await chat({ GROQ_API_KEY: 'gq-key' }, messages, { lane: 'scholar', model: 'qwen/qwen3-32b', ...solo });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('api.groq.com');
    expect(calls[0].body).not.toHaveProperty('chat_template_kwargs');
  });

  it('still sends it on the NVIDIA base, where it switches the leaked reasoning off', async () => {
    install(() => ok('hello'));
    await chat(env, messages, { lane: 'chat', model: 'nvidia/nemotron-3-nano-30b-a3b', ...solo });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('integrate.api.nvidia.com');
    expect(calls[0].body.chat_template_kwargs).toEqual({ thinking: false });
  });
});

describe('an upstream rate limit is answered 429, not 500', () => {
  const endpoints: Array<{ name: string; other?: () => Response; run: () => Promise<Response> }> = [
    { name: '/api/assistant', run: () => assistantPost({ request: post('/api/assistant', { messages: [{ role: 'user', content: 'play something calm' }] }), env }) },
    { name: '/api/lyrics-tools (explain)', run: () => lyricsPost({ request: post('/api/lyrics-tools', { mode: 'explain', lines: ['first line', 'second line'] }), env }) },
    { name: '/api/lyrics-tools (translate)', run: () => lyricsPost({ request: post('/api/lyrics-tools', { mode: 'translate', lines: ['first line', 'second line'] }), env }) },
    { name: '/api/dj', run: () => djPost({ request: post('/api/dj', { context: { currentTitle: 'Butta Bomma', currentArtist: 'Armaan Malik' }, pool: POOL, count: 3 }), env }) },
    // The playlist makes two passes (candidates, then the list). A 5xx on the
    // first pass rests every engine, and a fully rested ladder reads as "busy"
    // (429) by design, so its other-failure case is an empty answer instead.
    { name: '/api/playlist', other: blank, run: () => playlistPost({ request: post('/api/playlist', { prompt: 'Telugu workout songs with high energy' }), env }) },
  ];

  for (const { name, other, run } of endpoints) {
    it(`${name} surfaces an upstream 429 as 429`, async () => {
      install(rateLimited);
      const res = await run();
      expect(calls.length).toBeGreaterThan(0);
      expect(res.status).toBe(429);
      expect(res.headers.get('content-type')).toContain('application/json');
    });

    it(`${name} keeps its 500 JSON envelope for any other upstream failure`, async () => {
      install(other ?? broken);
      const res = await run();
      expect(calls.length).toBeGreaterThan(0);
      expect(res.status).toBe(500);
      const body = (await res.json()) as { error?: unknown };
      expect(typeof body.error).toBe('string');
    });
  }

  it('/api/dj still answers 503 ai_not_configured when no provider key is set', async () => {
    install(rateLimited);
    const res = await djPost({ request: post('/api/dj', { context: { currentTitle: 'Butta Bomma' }, pool: POOL, count: 3 }), env: {} });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error?: unknown }).error).toBe('ai_not_configured');
    expect(calls).toHaveLength(0);
  });
});
