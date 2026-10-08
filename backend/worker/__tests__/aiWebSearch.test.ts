/**
 * 11.0 — Gemini search grounding: the only web tool VinaX AI sends (the
 * provider's own, free on the Gemini 2.5 Flash family), its `sources` event,
 * the Auto ladder's "about now" lead, the model menu's tool entry, and the
 * edge-derived coarse place that replaced the Place switch.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

type Ctx = { request: Request; env: Record<string, string> };
interface Call { url: string; json: Record<string, unknown> }

let ip = 0;
const req = (body: unknown, cf?: Record<string, string>): Request => {
  const r = new Request('https://example.test/api/vinaxai', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': `10.78.3.${++ip}` },
    body: JSON.stringify(body),
  });
  if (cf) Object.defineProperty(r, 'cf', { value: cf });
  return r;
};
const sse = (text: string): Response =>
  new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } });
const GROUNDING = {
  webSearchQueries: ['weather hyderabad today'],
  searchEntryPoint: { renderedContent: '<div class="container">Search suggestions</div>' },
  groundingChunks: [
    { web: { uri: 'https://example.org/a', title: 'example.org' } },
    { web: { uri: 'https://example.org/a', title: 'dup' } },
    { web: { uri: 'ftp://example.org/x', title: 'not web' } },
    { web: { uri: 'https://example.com/b', title: 'x'.repeat(200) } },
  ],
  // 11.2 — chunk 1 repeats chunk 0's page and chunk 2 is not a web page:
  // indexes are remapped onto the de-duplicated items.
  groundingSupports: [
    { segment: { startIndex: 0, endIndex: 5, text: 'Sunny' }, groundingChunkIndices: [0, 1] },
    { segment: { text: 'Hot.' }, groundingChunkIndices: [2, 3, 99] },
    { segment: { text: 'Nothing backs this.' }, groundingChunkIndices: [2] },
    { segment: { text: '' }, groundingChunkIndices: [0] },
    'junk',
  ],
};
const geminiSse = (text: string, grounded = false): Response =>
  new Response(
    `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\n\n` +
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: '.' }] }, ...(grounded ? { groundingMetadata: GROUNDING } : {}) }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2 } })}\n\n`,
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
const GEMINI_LIST = {
  models: [
    { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-2.5-flash-lite', displayName: 'Gemini 2.5 Flash-Lite', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.8-flash', displayName: 'Gemini 3.8 Flash', supportedGenerationMethods: ['generateContent'] },
  ],
};

function stub(answer: (c: Call, n: number) => Response | Promise<Response>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (u: unknown, init?: RequestInit) => {
    const url = String(u);
    if (!init?.body) return new Response(JSON.stringify(url.includes('generativelanguage') ? GEMINI_LIST : { data: [], models: [] }), { status: 200 });
    let json: Record<string, unknown> = {};
    try { json = JSON.parse(String(init.body)) as Record<string, unknown>; } catch { /* not JSON */ }
    calls.push({ url, json });
    return answer(calls[calls.length - 1], calls.length);
  }));
  return calls;
}
const events = (text: string): Array<Record<string, unknown>> =>
  text.split('\n\n').filter((l) => l.startsWith('data:')).map((l) => JSON.parse(l.slice(5)) as Record<string, unknown>);
async function chat(body: Record<string, unknown>, env: Record<string, string>, cf?: Record<string, string>): Promise<Array<Record<string, unknown>>> {
  vi.resetModules();
  const m = (await import('../functions/api/vinaxai')) as unknown as { onRequestPost: (c: Ctx) => Promise<Response> };
  const res = await m.onRequestPost({ request: req({ messages: [{ role: 'user', content: 'hi' }], ...body }, cf), env });
  expect(res.status).toBe(200);
  return events(await res.text());
}
const tools = (c: Call): unknown => c.json.tools;
const GEM = { GEMINI_API_KEY: 'AIzaTESTKEY' };

afterEach(() => vi.unstubAllGlobals());

describe('searchCapable', () => {
  it('is the Gemini 2.5 Flash family only (grounding is free there, not on 3.x)', async () => {
    const { searchCapable, toolsFor, featureFlags } = await import('../functions/_lib/catalog');
    expect(searchCapable('gemini-2.5-flash')).toBe(true);
    expect(searchCapable('gemini-2.5-flash-lite')).toBe(true);
    expect(searchCapable('gemini-2.5-flash-preview-09-2025')).toBe(true);
    for (const id of ['gemini-3.8-flash', 'gemini-3-pro', 'gemini-2.5-pro', 'gemma-3-27b-it', 'openai/gpt-oss-120b', '']) expect(searchCapable(id)).toBe(false);
    const list = toolsFor('gemini', [{ id: 'gemini-2.5-flash' }, { id: 'gemini-3.8-flash' }]);
    expect(list.find((t) => t.id === 'web_search')).toEqual({ id: 'web_search', name: 'Web search', models: ['gemini-2.5-flash'] });
    expect(list.find((t) => t.id === 'code_execution')?.models).toEqual(['gemini-2.5-flash', 'gemini-3.8-flash']);
    expect(toolsFor('groq', [{ id: 'openai/gpt-oss-120b' }]).map((t) => t.id)).toEqual(['code_execution']);
    expect(featureFlags([], [list])).toMatchObject({ code: true, web: true });
    expect(featureFlags([], [toolsFor('gemini', [{ id: 'gemini-3.8-flash' }])])).toMatchObject({ code: true, web: false });
  });
});

describe('the Gemini transport', () => {
  it('sends googleSearch for web_search, codeExecution when both are asked, nothing otherwise', async () => {
    const { toNativeRequest, groundingSources } = await import('../functions/_lib/maestro');
    const base = { messages: [{ role: 'user', content: 'hi' }] };
    expect(toNativeRequest({ ...base, web_search: true }).tools).toEqual([{ googleSearch: {} }]);
    expect(toNativeRequest({ ...base, web_search: true, code_execution: true }).tools).toEqual([{ codeExecution: {} }]);
    expect(toNativeRequest(base).tools).toBeUndefined();
    const g = groundingSources(GROUNDING)!;
    expect(g.items).toEqual([{ url: 'https://example.org/a', title: 'example.org' }, { url: 'https://example.com/b', title: 'x'.repeat(120) }]);
    expect(g.queries).toEqual(['weather hyderabad today']);
    expect(g.entry).toContain('Search suggestions');
    expect(g.supports).toEqual([
      { text: 'Sunny', sources: [0] },
      { text: 'Hot.', sources: [1] },
    ]);
    expect(groundingSources({ groundingChunks: Array.from({ length: 12 }, (_, i) => ({ web: { uri: `https://e.org/${i}` } })) })!.items).toHaveLength(8);
    // 11.2 — a long segment keeps its END (where the sentence stops); supports are capped.
    const long = groundingSources({
      groundingChunks: [{ web: { uri: 'https://e.org/1', title: 'e.org' } }],
      groundingSupports: Array.from({ length: 60 }, (_, i) => ({ segment: { text: `${'a'.repeat(400)} end ${i}.` }, groundingChunkIndices: [0] })),
    })!;
    expect(long.supports).toHaveLength(40);
    expect(long.supports[0].text.length).toBeLessThanOrEqual(300);
    expect(long.supports[0].text.endsWith(' end 0.')).toBe(true);
    // A page past the eighth is dropped, and so is a support that only it backs.
    const many = groundingSources({
      groundingChunks: Array.from({ length: 10 }, (_, i) => ({ web: { uri: `https://e.org/${i}` } })),
      groundingSupports: [{ segment: { text: 'Ninth.' }, groundingChunkIndices: [9] }, { segment: { text: 'First and ninth.' }, groundingChunkIndices: [9, 0] }],
    })!;
    expect(many.supports).toEqual([{ text: 'First and ninth.', sources: [0] }]);
    expect(groundingSources({ webSearchQueries: ['q'] })!.supports).toEqual([]);
    expect(groundingSources(null)).toBeNull();
    expect(groundingSources({ groundingChunks: [] })).toBeNull();
  });
});

describe('POST /api/vinaxai — grounding', () => {
  it('a listener’s Gemini 2.5 Flash pick carries the tool, the prompt allows search, and the sources event follows the text', async () => {
    const calls = stub(() => geminiSse('Sunny', true));
    const ev = await chat({ mode: 'model', provider: 'gemini', model: 'gemini-2.5-flash' }, GEM);
    expect(calls[0].url).toContain('/models/gemini-2.5-flash:streamGenerateContent');
    expect(tools(calls[0])).toEqual([{ googleSearch: {} }]);
    const sys = String((calls[0].json.systemInstruction as { parts: Array<{ text: string }> }).parts[0].text);
    const { NO_LIVE_WEB, WEB_TOOL_LINE } = await import('../functions/api/vinaxai');
    expect(sys).toContain(WEB_TOOL_LINE);
    expect(sys).not.toContain(NO_LIVE_WEB);
    const meta = ev.find((e) => e.meta) as { meta: { tools?: string[]; modelId: string } };
    expect(meta.meta.modelId).toBe('gemini-2.5-flash');
    expect(meta.meta.tools).toEqual(['web_search']);
    const sources = ev.find((e) => e.sources) as { sources: { items: unknown[]; queries: string[]; entry: string } };
    expect(sources.sources.items).toEqual([{ url: 'https://example.org/a', title: 'example.org' }, { url: 'https://example.com/b', title: 'x'.repeat(120) }]);
    expect(sources.sources.entry).toContain('Search suggestions');
    expect((sources.sources as { supports?: unknown }).supports).toEqual([
      { text: 'Sunny', sources: [0] },
      { text: 'Hot.', sources: [1] },
    ]);
    expect(ev.indexOf(sources) > ev.findIndex((e) => e.delta)).toBe(true);
    expect(ev[ev.length - 1]).toEqual({ done: true });
  });

  it('a Gemini 3.x pick never carries the tool and never reports sources', async () => {
    const calls = stub(() => geminiSse('ok'));
    const ev = await chat({ mode: 'model', provider: 'gemini', model: 'gemini-3.8-flash' }, GEM);
    expect(tools(calls[0])).toBeUndefined();
    expect(ev.some((e) => e.sources)).toBe(false);
    expect((ev.find((e) => e.meta) as { meta: { tools?: string[] } }).meta.tools).toBeUndefined();
  });

  it('Run code wins over search on the same pick', async () => {
    const calls = stub(() => geminiSse('42'));
    const ev = await chat({ mode: 'model', provider: 'gemini', model: 'gemini-2.5-flash', tools: ['code_execution'] }, GEM);
    expect(tools(calls[0])).toEqual([{ codeExecution: {} }]);
    expect((ev.find((e) => e.meta) as { meta: { tools?: string[] } }).meta.tools).toEqual(['code_execution']);
  });

  it('Auto leads with a grounded Gemini 2.5 Flash attempt on a question about now, and not on a poem', async () => {
    const env = { NVIDIA_API_KEY: 'k-n', ...GEM };
    let calls = stub((c) => (c.url.includes('generativelanguage') ? geminiSse('28°C', true) : sse('ok')));
    let ev = await chat({ mode: 'auto', messages: [{ role: 'user', content: 'what is the weather in Hyderabad today?' }] }, env);
    expect(calls[0].url).toContain('/models/gemini-2.5-flash:streamGenerateContent');
    expect(tools(calls[0])).toEqual([{ googleSearch: {} }]);
    expect(ev.some((e) => e.sources)).toBe(true);
    vi.unstubAllGlobals();
    calls = stub((c) => (c.url.includes('generativelanguage') ? geminiSse('roses') : sse('ok')));
    ev = await chat({ mode: 'auto', messages: [{ role: 'user', content: 'write me a poem about the sea' }] }, env);
    expect(calls[0].url).not.toContain('gemini-2.5-flash');
    expect(tools(calls[0])).toBeUndefined();
    expect(ev.some((e) => e.sources)).toBe(false);
  });

  it('a 429 that names the grounding quota is retried once without the tool, and the lane keeps answering', async () => {
    // The retry without the tool may take the OpenAI-compatible door, which streams OpenAI-shaped SSE.
    const calls = stub((c) => (c.json.tools ? new Response(JSON.stringify({ error: { message: 'Quota exceeded for grounding requests per day' } }), { status: 429 }) : c.url.includes(':streamGenerateContent') ? geminiSse('plain') : sse('plain.')));
    const ev = await chat({ mode: 'model', provider: 'gemini', model: 'gemini-2.5-flash' }, GEM);
    expect(calls).toHaveLength(2);
    expect(tools(calls[1])).toBeUndefined();
    expect((ev.find((e) => e.meta) as { meta: { tools?: string[] } }).meta.tools).toBeUndefined();
    expect(ev.some((e) => e.delta === 'plain.')).toBe(true);
  });

  it('a non-Gemini answer never emits sources', async () => {
    stub(() => sse('hello'));
    const ev = await chat({ mode: 'auto', messages: [{ role: 'user', content: 'what is the latest news?' }] }, { NVIDIA_API_KEY: 'k-n' });
    expect(ev.some((e) => e.sources)).toBe(false);
  });
});

describe('wantsWeb', () => {
  it('fires on time, money, news and schedule cues only', async () => {
    const { wantsWeb } = await import('../functions/api/vinaxai');
    for (const q of ['what day is it today', 'latest Telugu releases', 'who won the match', 'bitcoin price', 'is the metro open on sunday', 'concerts in 2027', 'weather tonight', 'this week in music'])
      expect(wantsWeb(q), q).toBe(true);
    for (const q of ['write me a poem', 'who sang Srivalli', 'explain ragas', 'suggest sad songs', '']) expect(wantsWeb(q), q).toBe(false);
  });
});

describe('GET /api/aimodels', () => {
  it('lists Web search for the Gemini 2.5 Flash models and sets features.web', async () => {
    stub(() => sse(''));
    vi.resetModules();
    const m = (await import('../functions/api/aimodels')) as unknown as { onRequestGet: (c: Ctx) => Promise<Response> };
    const res = await m.onRequestGet({ request: new Request('https://example.test/api/aimodels', { headers: { 'cf-connecting-ip': '10.79.1.1' } }), env: GEM });
    const body = (await res.json()) as { providers: Array<{ id: string; tools: Array<{ id: string; models: string[] }> }>; features: { web: boolean; code: boolean } };
    const gemini = body.providers.find((p) => p.id === 'gemini')!;
    expect(gemini.tools.find((t) => t.id === 'web_search')?.models).toEqual(['gemini-2.5-flash', 'gemini-2.5-flash-lite']);
    expect(gemini.tools.find((t) => t.id === 'code_execution')?.models).toContain('gemini-3.8-flash');
    expect(body.features).toMatchObject({ web: true, code: true });
  });
});

describe('place', () => {
  it('{ off: true } sends no place; a missing place comes from the edge; the line says it is approximate and from the connection', async () => {
    const { requestPlace, placeContextLines, placeOptOut, edgePlace } = await import('../functions/_lib/place');
    const cf = { country: 'IN', region: 'Telangana', city: 'Hyderabad', timezone: 'Asia/Kolkata' };
    expect(placeOptOut({ off: true })).toBe(true);
    expect(requestPlace({ off: true }, req({}, cf))).toBeNull();
    expect(placeContextLines(null)).toMatch(/IST\.$/);
    expect(requestPlace(undefined, req({}, cf))).toEqual({ ...cf, source: 'edge' });
    expect(requestPlace({ country: 'nonsense' }, req({}, cf))).toEqual({ ...cf, source: 'edge' });
    expect(requestPlace({ country: 'GB', timezone: 'Europe/London', source: 'manual' }, req({}, cf))).toMatchObject({ country: 'GB', source: 'manual' });
    expect(edgePlace(req({}))).toBeNull();
    expect(edgePlace(req({}, { country: 'XX', timezone: 'bad zone' }))).toBeNull();
    const line = placeContextLines(requestPlace(undefined, req({}, cf)));
    expect(line).toContain('local time (Asia/Kolkata)');
    expect(line).toMatch(/approximate — derived from the network connection/);
    expect(line).toContain('approximate city Hyderabad');
  });

  it('the chat prompt opens with the edge place when the client sent none, and with IST on { off: true }', async () => {
    const cf = { country: 'GB', region: 'England', city: 'London', timezone: 'Europe/London' };
    let calls = stub(() => sse('ok'));
    await chat({ mode: 'auto' }, { NVIDIA_API_KEY: 'k-n' }, cf);
    let sys = String((calls[0].json.messages as Array<{ content: string }>)[0].content);
    expect(sys).toContain('local time (Europe/London)');
    expect(sys).toContain('country GB');
    vi.unstubAllGlobals();
    calls = stub(() => sse('ok'));
    await chat({ mode: 'auto', place: { off: true } }, { NVIDIA_API_KEY: 'k-n' }, cf);
    sys = String((calls[0].json.messages as Array<{ content: string }>)[0].content);
    expect(sys).toMatch(/Current date & time: .* IST\./);
    expect(sys).not.toContain('LISTENER PLACE');
  });
});
