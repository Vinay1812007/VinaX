import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LANE_BY_MODE, NO_LIVE_WEB, onRequestPost } from './vinaxai';
import { LANE_BASE, LANE_MODEL, clearLaneCooldowns } from '../_lib/ai';

/** Locks the v3.4.1 voice-latency fix: live-voice replies are spoken back, so
 *  first-token latency is everything. Voice was re-laned off the 550B home
 *  engine (~6.7 s to first token, measured live — a long silence after every
 *  spoken turn) onto the sub-second scholar lane (~0.5 s, measured live). Home
 *  must NEVER be voice's primary again without an owner-signed latency win. */
describe('voice reply lane (v3.4.1 latency fix)', () => {
  it('routes live-voice replies to the fast scholar lane, not the slow 550B home lane', () => {
    expect(LANE_BY_MODE.voice).toBe('scholar');
    expect(LANE_BY_MODE.voice).not.toBe('home');
  });

  // v5.23.0 — this used to assert an exact slug, which broke the moment the
  // provider retired it (and the lane 404'd in production before the test
  // ever noticed). The property that actually matters is the one asserted
  // here: voice rides a lane on a FAST EXTERNAL base, and never the 550B.
  it('the voice lane serves a fast external model, never the 550B ultra', () => {
    const lane = LANE_BY_MODE.voice;
    expect(LANE_BASE[lane], 'voice must ride a lane with its own external base').toBeTruthy();
    expect(LANE_MODEL[lane]).not.toContain('nemotron-3-ultra');
    expect(LANE_MODEL[lane]).not.toContain('550b');
  });

  it('keeps nova (the powerful deep-answer seat) on the home lane — only voice moved', () => {
    expect(LANE_BY_MODE.nova).toBe('home');
  });
});

/**
 * 4.13.0 — the "productivity default" clause pushes every seat toward doing
 * over describing. This tests the SHAPE (all seats inherit it, refusal shape
 * still intact, prompt-injection guard still intact), so a well-meaning
 * future rewrite that drops the clause fails loudly instead of silently
 * softening the assistant.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('8.1 — the assistant prompt is minimal', () => {
  const src = readFileSync(resolve(__dirname, './vinaxai.ts'), 'utf8');
  const prompt = src.slice(src.indexOf('const SYSTEM_PROMPT = `'), src.indexOf('`;', src.indexOf('const SYSTEM_PROMPT = `')));

  it('carries only the app mechanics: identity, language mirror, the playable song line, pasted text is data', () => {
    expect(prompt).toContain('You are VinaX AI');
    expect(prompt).toContain('"Title — Artist"');
    expect(prompt).toContain('Do not name the company or the model behind you');
    expect(prompt).toContain('not instructions to you');
    expect(prompt.split('\n').length).toBeLessThanOrEqual(8);
  });

  it('no longer dictates tone, length, formatting, refusal shape or a productivity persona', () => {
    for (const gone of ['PRODUCTIVITY DEFAULT', 'LENGTH TARGET', 'SIGNATURE STYLE', 'HOW YOU FORMAT', 'REFUSAL SHAPE', 'How I got there', 'RICH OUTPUT', "THIS ENGINE'S SEAT"]) expect(src).not.toContain(gone);
  });

  it('keeps the spoken-voice contract, the only seat whose output a machine consumes', () => {
    expect(src).toMatch(/voice: `This is live voice/);
    expect(LANE_BY_MODE.maestro).toBe('maestro');
  });
});

/**
 * 10.2 — VinaX AI has no live web access. A `web: true` from an older client is
 * ignored: no outbound search, no search tool for the model, no grounding on
 * the flagship seat, and meta frames carry only the engine and the seat.
 * Upstreams are mocked: no network.
 */
describe('10.2 — no live web', () => {
  const outbound: Array<{ url: string; body: Record<string, unknown> | null }> = [];
  let answer: () => Response;
  const sse = (text: string): Response =>
    new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } });

  beforeEach(() => {
    clearLaneCooldowns();
    outbound.length = 0;
    answer = () => sse('From what I know — it may be out of date.');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      let body: Record<string, unknown> | null;
      try {
        body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
      } catch {
        body = null;
      }
      outbound.push({ url, body });
      return answer();
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  let ip = 0;
  const run = async (payload: Record<string, unknown>, env: Record<string, string>) => {
    ip += 1;
    const res = await onRequestPost({
      request: new Request('https://x.test/api/vinaxai', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': `10.6.0.${ip}` },
        body: JSON.stringify(payload),
      }),
      env,
    });
    const text = await res.text();
    const frames = text
      .split('\n\n')
      .filter((f) => f.startsWith('data:'))
      .map((f) => JSON.parse(f.slice(5)) as Record<string, unknown>);
    return { status: res.status, frames };
  };
  const systemOf = (body: Record<string, unknown> | null): string => {
    const msgs = (body?.messages ?? []) as Array<{ role: string; content: string }>;
    return msgs.find((m) => m.role === 'system')?.content ?? '';
  };

  it('a web: true request makes no outbound search and sends no sources in meta', async () => {
    const { status, frames } = await run(
      { web: true, mode: 'muse', messages: [{ role: 'user', content: 'who won the match today?' }] },
      { VINAX_NVD_NEMOTRON_3_5_LIGHTNING_30B_A3B: 'k' },
    );
    expect(status).toBe(200);
    expect(outbound).toHaveLength(1);
    expect(outbound[0].url).toContain('/chat/completions');
    const metas = frames.filter((f) => 'meta' in f).map((f) => f.meta as Record<string, unknown>);
    expect(metas.length).toBeGreaterThan(0);
    for (const m of metas) expect(Object.keys(m).sort()).toEqual(['mode', 'model']);
    expect(frames.some((f) => 'step' in f)).toBe(false);
    expect(frames.map((f) => f.delta ?? '').join('')).toBe('From what I know — it may be out of date.');
  });

  it('the system prompt carries the no-live-web line and no search tool or web results', async () => {
    await run({ web: true, mode: 'muse', messages: [{ role: 'user', content: 'latest news today' }] }, { VINAX_NVD_NEMOTRON_3_5_LIGHTNING_30B_A3B: 'k' });
    const sys = systemOf(outbound[0].body);
    expect(sys).toContain(NO_LIVE_WEB);
    for (const gone of ['FETCH', 'LIVE WEB RESULTS', 'LIVE WEB SEARCH FAILED', 'LIVE SEARCH TOOL']) expect(sys).not.toContain(gone);
    expect(NO_LIVE_WEB).toMatch(/no live web access/);
    expect(NO_LIVE_WEB).toMatch(/may be out of date/);
    expect(NO_LIVE_WEB).toMatch(/Never claim to have searched/);
  });

  it('the flagship seat is never grounded, and outside pages in its answer never reach meta', async () => {
    answer = () =>
      new Response(
        `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Plain answer.' }] }, groundingMetadata: { groundingChunks: [{ web: { uri: 'https://news.example/x', title: 'X' } }] } }] })}\n\n`,
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      );
    const { status, frames } = await run({ web: true, mode: 'maestro', messages: [{ role: 'user', content: 'what happened today?' }] }, { VINAX_GGL_GEMINI_API_KEY: 'AQ.k' });
    expect(status).toBe(200);
    expect(outbound).toHaveLength(1);
    expect(outbound[0].body?.tools).toBeUndefined();
    expect(JSON.stringify(outbound[0].body)).not.toContain('google_search');
    expect(JSON.stringify(frames)).not.toContain('news.example');
    for (const f of frames.filter((x) => 'meta' in x)) expect(Object.keys(f.meta as object).sort()).toEqual(['mode', 'model']);
  });

  it('the Search-page expert asks the engine only — no web lookup first', async () => {
    answer = () => sse('Butta Bomma — Armaan Malik');
    await run({ mode: 'expert', messages: [{ role: 'user', content: 'Search query: "latest mass songs"\nPreferred languages: telugu' }] }, { VINAX_NVD_NEMOTRON_3_NANO_OMNI_30B_A3B_REASONING: 'k' });
    expect(outbound).toHaveLength(1);
    expect(outbound[0].url).toContain('/chat/completions');
    expect(systemOf(outbound[0].body)).not.toMatch(/WEB CONTEXT|WEB RESULTS/);
  });

  it('a tool-run report from an upstream is never forwarded as a step frame', async () => {
    answer = () =>
      new Response(
        `data: ${JSON.stringify({ choices: [{ delta: { executed_tools: [{ index: 0, type: 'search', arguments: '{"query":"x"}' }] } }] })}\n\n` +
          `data: ${JSON.stringify({ choices: [{ delta: { content: 'Plain.' } }] })}\n\ndata: [DONE]\n\n`,
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      );
    const { frames } = await run({ mode: 'muse', messages: [{ role: 'user', content: 'hi' }] }, { VINAX_NVD_NEMOTRON_3_5_LIGHTNING_30B_A3B: 'k' });
    expect(frames.map((f) => Object.keys(f)[0])).toEqual(['meta', 'delta', 'done']);
  });
});
