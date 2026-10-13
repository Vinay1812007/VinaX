/**
 * 12.0 — VinaX AI: small talk on the fast seat, a title for a new chat,
 * reasoning passed on as `think` frames, deep research (plan → 4 searches →
 * a cited report, within its daily cap), pictures through signed links, and
 * the two image routes. Every upstream is mocked: no network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSerperState } from '../functions/_lib/serper';
import { resetCounts, isSmallTalk, cleanTitle, parsePlan, logoHost, signedImagePath, imageSignatureOk } from '../functions/_lib/chatExtras';
import { resetAiControlsCache } from '../functions/_lib/ai';

type Ctx = { request: Request; env: Record<string, string>; waitUntil?: (p: Promise<unknown>) => void };
interface Call { url: string; method: string; json: Record<string, unknown> }

const DB = { SUPABASE_URL: 'https://db.example.test', SUPABASE_SERVICE_ROLE_KEY: 'svc' };
const KEYS = { NVIDIA_API_KEY: 'k-n', GROQ_API_KEY: 'k-g', SERPER_API_KEY: 'serper-k', TELEMETRY_PEPPER: 'pepper-for-tests' };
const ORGANIC = (q: string) => ({
  knowledgeGraph: { description: 'A carmaker.', imageUrl: 'https://img.example/logo.png' },
  organic: [
    { title: `About ${q}`, link: `https://a.example/${encodeURIComponent(q)}`, snippet: 'One.', imageUrl: 'https://img.example/one.jpg' },
    { title: `More on ${q}`, link: `https://b.example/${encodeURIComponent(q)}`, snippet: 'Two.' },
  ],
});

let ip = 0;
const req = (body: unknown): Request =>
  new Request('https://example.test/api/vinaxai', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': `10.91.0.${++ip % 250}` }, body: JSON.stringify(body) });
const sse = (...chunks: Array<Record<string, unknown>>): Response =>
  new Response(chunks.map((c) => `data: ${JSON.stringify({ choices: [{ delta: c }] })}\n\n`).join('') + 'data: [DONE]\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } });
const json = (content: string): Response => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200, headers: { 'content-type': 'application/json' } });

interface Opts { answer?: (c: Call) => Response; plan?: string; title?: string; researchToday?: number }
function stub(o: Opts = {}): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (u: unknown, init?: RequestInit) => {
    const url = String(u);
    const method = init?.method ?? 'GET';
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>; } catch { /* not JSON */ }
    const call = { url, method, json: body };
    calls.push(call);
    if (url.startsWith('https://google.serper.dev/')) return new Response(JSON.stringify(ORGANIC(String(body.q))), { status: 200 });
    if (url.includes('/rest/v1/vinax_ai_events') && method === 'GET') return new Response('[]', { status: 200, headers: { 'content-range': `0-0/${url.includes('deep-research') ? (o.researchToday ?? 0) : 0}` } });
    if (url.includes('/rest/v1/')) return new Response(method === 'GET' ? '[]' : null, { status: method === 'GET' ? 200 : 201 });
    if (method === 'GET') return new Response(JSON.stringify({ data: [], models: [] }), { status: 200 });
    // Non-streamed side calls: the title and the research plan.
    if (body.stream !== true) {
      const sys = String((body.messages as Array<{ content: string }>)?.[0]?.content ?? '');
      if (sys.startsWith('You name chats')) return json(o.title ?? 'BMW meaning explained');
      if (sys.startsWith('You plan web research')) return json(o.plan ?? '["BMW history", "BMW sales 2025", "BMW logo meaning"]');
      return json('ok');
    }
    return o.answer ? o.answer(call) : sse({ content: 'Answer [1].' });
  }));
  return calls;
}
const events = (t: string): Array<Record<string, unknown>> => t.split('\n\n').filter((l) => l.startsWith('data:')).map((l) => JSON.parse(l.slice(5)) as Record<string, unknown>);
async function chat(body: Record<string, unknown>, env: Record<string, string> = KEYS): Promise<Array<Record<string, unknown>>> {
  vi.resetModules();
  const m = (await import('../functions/api/vinaxai')) as unknown as { onRequestPost: (c: Ctx) => Promise<Response> };
  const waits: Promise<unknown>[] = [];
  const res = await m.onRequestPost({ request: req(body), env, waitUntil: (p) => waits.push(p) });
  expect(res.status).toBe(200);
  const out = events(await res.text());
  await Promise.all(waits);
  return out;
}
const streamed = (c: Call[]): Call[] => c.filter((x) => x.method === 'POST' && x.json.stream === true);
const serperCalls = (c: Call[]): Call[] => c.filter((x) => x.url.startsWith('https://google.serper.dev/'));
const sysOf = (c: Call): string => String((c.json.messages as Array<{ content: string }>)[0].content);

beforeEach(() => {
  resetSerperState();
  resetCounts();
  resetAiControlsCache();
});
afterEach(() => vi.unstubAllGlobals());

describe('small talk', () => {
  it('isSmallTalk: greetings and thanks, not questions', () => {
    for (const yes of ['hi', 'Hello!', 'hey there', 'thanks a lot', 'ok', 'good morning 🙂', 'namaste', 'how are you?', 'bye 👋']) expect(isSmallTalk(yes)).toBe(true);
    for (const no of ['hi, what is the weather today?', 'hello world program in python', 'thanks, now explain recursion', 'what is BMW', '']) expect(isSmallTalk(no)).toBe(false);
  });

  it('"hi" on Auto goes to the fast seat with a short budget, no search, no title', async () => {
    const calls = stub();
    await chat({ mode: 'auto', messages: [{ role: 'user', content: 'hi' }] });
    const s = streamed(calls);
    expect(s).toHaveLength(1);
    expect(s[0].url).toContain('groq');
    expect(s[0].json.max_tokens).toBe(400);
    expect(sysOf(s[0])).toContain('This is small talk.');
    expect(sysOf(s[0])).not.toContain('FOLLOW-UPS');
    expect(serperCalls(calls)).toHaveLength(0);
    expect(calls.some((c) => String((c.json.messages as Array<{ content: string }> | undefined)?.[0]?.content ?? '').startsWith('You name chats'))).toBe(false);
  });
});

describe('titles', () => {
  it('cleanTitle keeps 2–6 plain words', () => {
    expect(cleanTitle('"BMW meaning explained."')).toBe('BMW meaning explained');
    expect(cleanTitle('Title: **telugu party playlist**')).toBe('Telugu party playlist');
    expect(cleanTitle('<think>hmm</think>\nFix React build error')).toBe('Fix React build error');
    expect(cleanTitle('')).toBe('');
  });

  it('a new chat gets one title frame before done; a later turn does not', async () => {
    stub();
    let ev = await chat({ mode: 'auto', title: true, messages: [{ role: 'user', content: 'what is the meaning of BMW' }] });
    const i = ev.findIndex((e) => e.title);
    expect(ev[i]).toEqual({ title: 'BMW meaning explained' });
    expect(i).toBeLessThan(ev.findIndex((e) => e.done));
    stub();
    ev = await chat({ mode: 'auto', title: true, messages: [{ role: 'user', content: 'what is BMW' }, { role: 'assistant', content: 'A carmaker.' }, { role: 'user', content: 'and Audi?' }] });
    expect(ev.some((e) => e.title)).toBe(false);
  });

  it('the format rule rides every normal reply', async () => {
    const calls = stub();
    await chat({ mode: 'auto', messages: [{ role: 'user', content: 'explain photosynthesis' }] });
    expect(sysOf(streamed(calls)[0])).toContain('FORMAT: Start with the direct answer');
  });
});

describe('reasoning', () => {
  it('a <think> block is passed on as think frames and never enters the reply', async () => {
    stub({ answer: () => sse({ content: '<think>Let me' }, { content: ' work it out.</th' }, { content: 'ink>The answer is 4.' }) });
    const ev = await chat({ mode: 'auto', messages: [{ role: 'user', content: 'what is 2 plus 2, step by step please' }] });
    const think = ev.filter((e) => typeof e.think === 'string').map((e) => e.think).join('');
    expect(think).toBe('Let me work it out.');
    expect(ev.filter((e) => typeof e.delta === 'string').map((e) => e.delta).join('')).toBe('The answer is 4.');
  });

  it('a reasoning field is passed on too', async () => {
    stub({ answer: () => sse({ reasoning: 'Thinking about it. ' }, { reasoning_content: 'Still thinking.' }, { content: 'Done.' }) });
    const ev = await chat({ mode: 'auto', messages: [{ role: 'user', content: 'explain the theory of relativity' }] });
    expect(ev.filter((e) => typeof e.think === 'string').map((e) => e.think).join('')).toBe('Thinking about it. Still thinking.');
  });
});

describe('deep research', () => {
  it('plans, runs 4 searches, writes a cited report, and logs one research run', async () => {
    const calls = stub();
    const ev = await chat({ mode: 'auto', research: true, messages: [{ role: 'user', content: 'BMW' }] }, { ...KEYS, ...DB });
    const steps = ev.filter((e) => e.status).map((e) => (e.status as { step: string }).step);
    expect(steps).toEqual(['planning', 'searching', 'searched']);
    const s = serperCalls(calls);
    expect(s.map((c) => c.json.q)).toEqual(['BMW', 'BMW history', 'BMW sales 2025', 'BMW logo meaning']);
    const report = streamed(calls)[0];
    expect(sysOf(report)).toContain('DEEP RESEARCH:');
    expect(sysOf(report)).toContain('[8]');
    const src = ev.find((e) => e.sources)?.sources as { items: unknown[]; queries: string[]; images?: Array<{ src: string }> };
    expect(src.items).toHaveLength(8);
    expect(src.queries).toHaveLength(4);
    expect(src.images?.length).toBeGreaterThan(0);
    expect(src.images?.every((i) => i.src.startsWith('/api/webimg?u=') && /&s=[0-9a-f]{32}$/.test(i.src))).toBe(true);
    const logged = calls.filter((c) => c.url.includes('/rest/v1/vinax_ai_events') && c.method === 'POST').map((c) => c.json);
    expect(logged.some((r) => r.feature === 'deep-research' && r.model === 'research' && r.ok === true)).toBe(true);
  });

  it('stops at RESEARCH_DAILY_LIMIT, and the owner can switch it off; the chat still answers', async () => {
    let calls = stub({ researchToday: 1 });
    await chat({ mode: 'auto', research: true, messages: [{ role: 'user', content: 'BMW' }] }, { ...KEYS, ...DB, RESEARCH_DAILY_LIMIT: '2' });
    expect(serperCalls(calls)).toHaveLength(4);
    calls = stub({ researchToday: 2 });
    const ev = await chat({ mode: 'auto', research: true, messages: [{ role: 'user', content: 'Audi' }] }, { ...KEYS, ...DB, RESEARCH_DAILY_LIMIT: '2' });
    expect(serperCalls(calls)).toHaveLength(0);
    expect(ev.some((e) => typeof e.delta === 'string')).toBe(true);
    calls = stub({ researchToday: 0 });
    vi.stubGlobal('fetch', ((f) => async (u: unknown, init?: RequestInit) => (String(u).includes('/rest/v1/vinax_config') && (init?.method ?? 'GET') === 'GET' ? new Response(JSON.stringify([{ key: 'ai-controls', value: { features: { 'deep-research': false } } }]), { status: 200 }) : f(u, init)))(globalThis.fetch as (u: unknown, init?: RequestInit) => Promise<Response>));
    await chat({ mode: 'auto', research: true, messages: [{ role: 'user', content: 'Mercedes' }] }, { ...KEYS, ...DB });
    expect(serperCalls(calls)).toHaveLength(0);
  });

  it('parsePlan reads a JSON array or lines', () => {
    expect(parsePlan('```json\n["a b", "c d", "e f", "g h"]\n```')).toEqual(['a b', 'c d', 'e f']);
    expect(parsePlan('1. first query here\n2. second query here')).toEqual(['first query here', 'second query here']);
    expect(parsePlan('nonsense')).toEqual([]);
  });
});

describe('pictures and logos through the Worker', () => {
  it('only signed picture links load, and only raster images', async () => {
    const env = { TELEMETRY_PEPPER: 'pepper-for-tests' };
    const path = await signedImagePath(env, 'https://img.example/one.jpg');
    const u = new URL(`https://example.test${path}`);
    expect(await imageSignatureOk(env, u.searchParams.get('u')!, u.searchParams.get('s')!)).toBe(true);
    expect(await imageSignatureOk(env, 'https://evil.example/x.jpg', u.searchParams.get('s')!)).toBe(false);
    expect(await signedImagePath({}, 'https://img.example/one.jpg')).toBeNull();
    const { onRequestGet } = await import('../functions/api/webimg');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<svg/>', { status: 200, headers: { 'content-type': 'image/svg+xml' } })));
    expect((await onRequestGet({ request: new Request(`https://example.test/api/webimg?u=${encodeURIComponent('https://evil.example/x.jpg')}&s=${u.searchParams.get('s')}`), env })).status).toBe(403);
    expect((await onRequestGet({ request: new Request(`https://example.test${path}`), env })).status).toBe(404);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/jpeg' } })));
    const ok = await onRequestGet({ request: new Request(`https://example.test${path}`), env });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('image/jpeg');
  });

  it('logos: public host names only', async () => {
    expect(logoHost('www.BBC.co.uk')).toBe('bbc.co.uk');
    for (const bad of ['localhost', '127.0.0.1', 'a', 'x.internal', 'evil.com:8080', 'http://x.com', '']) expect(logoHost(bad)).toBeNull();
    const { onRequestGet } = await import('../functions/api/favicon');
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: unknown) => {
      seen.push(String(u));
      return new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { 'content-type': 'image/png' } });
    }));
    expect((await onRequestGet({ request: new Request('https://example.test/api/favicon?host=127.0.0.1'), env: {} })).status).toBe(404);
    const res = await onRequestGet({ request: new Request('https://example.test/api/favicon?host=example.com'), env: {} });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=604800');
    expect(seen).toEqual(['https://www.google.com/s2/favicons?domain=example.com&sz=64']);
  });
});
