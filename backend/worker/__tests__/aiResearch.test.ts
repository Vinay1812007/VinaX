/**
 * VinaX AI — Research (research.ts): the plan's shape, merging several
 * searches into one numbered list, the fallback to one plain search, and
 * the chat route running it: the progress events, the sources marked as
 * research, the report rules in the prompt, the per-person daily allowance
 * (and one plain search once it is spent), and the models route saying
 * whether Research is offered.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequestPost } from '../functions/api/ai/chat';
import { onRequestGet as modelsGet } from '../functions/api/ai/models';
import { mergeSources, planQueries, researchWeb, RESEARCH_MAX_QUERIES, RESEARCH_MAX_SOURCES, validatePlan } from '../functions/_lib/ai/research';
import { RESEARCH_RULES } from '../functions/_lib/ai/prompt';
import { _resetSearch } from '../functions/_lib/ai/search';
import { issueSession } from '../functions/_lib/googleAuth';
import { resetSettingsMemo } from '../functions/_lib/settings';
import { _resetRateLimitsForTests } from '../functions/_lib/ratelimit';
import { _resetCooldowns } from '../functions/_lib/ai/cooldown';
import type { Source } from '../functions/_lib/ai/types';
import { DB_ENV, fakeDb, type FakeDb } from './helpers/fakeDb';
import { openAiSse, readEvents, sseResponse } from './helpers/aiStreams';

const ENV = { GOOGLE_CLIENT_ID: 'x.apps.googleusercontent.com', AUTH_SECRET: 'auth-secret', ...DB_ENV, GROQ_API_KEY: 'gsk_test', GEMINI_API_KEY: 'gem_test', NVIDIA_API_KEY: 'nv_test', SEARCH_API_KEY: 'tvly-test' };
let ip = 0;
let pending: Array<Promise<unknown>> = [];

const src = (n: number, url: string, title = url): Source => ({ n, url, title, site: new URL(url).hostname.replace(/^www\./, ''), snippet: `about ${title}` });

describe('validatePlan', () => {
  it('takes {queries: [...]} or a bare list, trims, drops blanks and repeats, keeps at most four', () => {
    expect(validatePlan({ queries: [' india  final 2026 ', 'INDIA FINAL 2026', '', 'bbc cricket final', 'a', 'b', 'c'] })).toEqual(['india final 2026', 'bbc cricket final', 'a', 'b']);
    expect(validatePlan(['one'])).toEqual(['one']);
    expect(validatePlan({ queries: [] })).toBeNull();
    expect(validatePlan('nope')).toBeNull();
    expect(validatePlan({ queries: [42, null] })).toBeNull();
  });
});

describe('mergeSources', () => {
  it('takes each list in turn, renumbers from 1, drops the same page twice, keeps at most twelve', () => {
    const a = [src(1, 'https://www.a.com/x'), src(2, 'https://a.com/y')];
    const b = [src(1, 'https://b.org/'), src(2, 'https://a.com/x/')];
    const out = mergeSources([a, b]);
    expect(out.map((s) => [s.n, s.url])).toEqual([[1, 'https://www.a.com/x'], [2, 'https://b.org/'], [3, 'https://a.com/y']]);
    const many = Array.from({ length: 5 }, (_, l) => Array.from({ length: 6 }, (_, i) => src(i + 1, `https://s${l}.com/${i}`)));
    expect(mergeSources(many)).toHaveLength(RESEARCH_MAX_SOURCES);
    expect(mergeSources([])).toEqual([]);
  });
});

describe('planQueries and researchWeb', () => {
  let fake: FakeDb;
  let planAnswer: () => Response;
  let searches: string[];
  beforeEach(() => {
    _resetSearch();
    resetSettingsMemo();
    _resetCooldowns();
    searches = [];
    planAnswer = () => sseResponse(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"queries": ["india final 2026 result", "india australia final scorecard", "final highlights news"]}' }] }, finishReason: 'STOP' }] })}\n\n`);
    fake = fakeDb({ settings: [{ key: 'vinax-ai', value: { enabled: true }, updated_at: '2026-10-30T00:00:00Z', updated_by: 'owner' }] }, (url, init) => {
      if (url.includes('tavily')) {
        const q = (JSON.parse(String(init?.body)) as { query: string }).query;
        searches.push(q);
        return new Response(JSON.stringify({ results: [{ url: `https://news.example.com/${searches.length}`, title: `Result for ${q}`, content: 'Snippet' }, { url: 'https://shared.example.org/', title: 'Shared page', content: 'Same everywhere' }] }), { status: 200 });
      }
      return planAnswer();
    });
    fake.answer('rpc/ai_take_daily', () => new Response('true', { status: 200, headers: { 'content-type': 'application/json' } }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('the plan comes from the title ladder with the question as material; the plain query leads when the planner left it out', async () => {
    const r = await planQueries(ENV, 'Who won the 2026 final?', null);
    expect(r.planned).toBe(true);
    expect(r.queries).toEqual(['Who won the 2026 final?', 'india final 2026 result', 'india australia final scorecard', 'final highlights news']);
    expect(r.queries.length).toBeLessThanOrEqual(RESEARCH_MAX_QUERIES);
    const asked = fake.other.find((c) => c.url.includes('generativelanguage'));
    expect(asked).toBeTruthy();
  });

  it('falls back to the one plain query when the planner answers nonsense', async () => {
    planAnswer = () => sseResponse(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'I cannot plan this.' }] }, finishReason: 'STOP' }] })}\n\n`);
    const r = await planQueries(ENV, 'Who won the 2026 final?', 'Tell me about cricket');
    expect(r).toEqual({ planned: false, queries: ['Who won the 2026 final?'] });
  });

  it('runs every query, tells the page the plan and the progress, and merges the results without repeats', async () => {
    const planned: string[][] = [];
    const progress: number[] = [];
    const r = await researchWeb(ENV, { question: 'Who won the 2026 final?', previousUser: null, ownerCap: null, onPlanned: (q) => planned.push(q), onSearched: (d) => progress.push(d) });
    expect(planned).toHaveLength(1);
    expect(searches).toHaveLength(4);
    expect(progress).toEqual([1, 2, 3, 4]);
    expect(r.answered).toBe(4);
    // Four pages of their own plus the one page every search shared.
    expect(r.sources).toHaveLength(5);
    expect(r.sources.map((s) => s.n)).toEqual([1, 2, 3, 4, 5]);
    expect(r.sources.filter((s) => s.url === 'https://shared.example.org/')).toHaveLength(1);
    // Each search took one from the day's allowance.
    expect(fake.calls.filter((c) => c.table === 'rpc/ai_take_daily')).toHaveLength(4);
  });
});

describe('POST /api/ai/chat with research', () => {
  let fake: FakeDb;
  let sent: Array<{ messages: Array<{ role: string; content: string }> }>;
  let searches: string[];
  let takes: Array<Record<string, unknown>>;
  let allow: (kind: string) => boolean;

  function seed(setting: Record<string, unknown> = { enabled: true }): void {
    sent = [];
    searches = [];
    takes = [];
    allow = () => true;
    fake = fakeDb({
      accounts: [{ id: '1001', name: 'Asha Rao' }],
      settings: [{ key: 'vinax-ai', value: setting, updated_at: '2026-10-30T00:00:00Z', updated_by: 'owner' }],
    }, (url, init) => {
      const body = String(init?.body ?? '');
      if (url.includes('tavily')) {
        const q = (JSON.parse(body) as { query: string }).query;
        searches.push(q);
        return new Response(JSON.stringify({ results: [{ url: `https://site${searches.length}.example.com/`, title: `Page ${searches.length}`, content: 'Snippet' }] }), { status: 200 });
      }
      if (body.includes('You write titles for chats')) return sseResponse(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Final result' }] }, finishReason: 'STOP' }] })}\n\n`);
      if (body.includes('You plan web research')) return sseResponse(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"queries":["final result 2026","final scorecard"]}' }] }, finishReason: 'STOP' }] })}\n\n`);
      sent.push(JSON.parse(body));
      return sseResponse(openAiSse('India won.[1] The margin was six runs.[2]'));
    });
    fake.answer('rpc/ai_take_daily', (call) => {
      const b = call.body as Record<string, unknown>;
      takes.push(b);
      return new Response(allow(String(b.p_kind)) ? 'true' : 'false', { status: 200, headers: { 'content-type': 'application/json' } });
    });
  }

  async function post(body: Record<string, unknown>): Promise<Response> {
    const token = await issueSession(ENV, '1001');
    const request = new Request('https://www.vinaxmusic.online/api/ai/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': `203.0.113.${++ip % 250}`, authorization: `Bearer ${token}` },
      body: JSON.stringify({ conversationId: null, content: [{ type: 'text', text: 'Who won the 2026 final?' }], mode: 'auto', timezone: 'Asia/Kolkata', locale: 'en-IN', ...body }),
    });
    return onRequestPost({ request, env: ENV as never, waitUntil: (p) => { pending.push(p); } });
  }
  const settle = async () => { await Promise.all(pending); pending = []; };

  beforeEach(() => { _resetRateLimitsForTests(); resetSettingsMemo(); _resetCooldowns(); _resetSearch(); });
  afterEach(() => vi.unstubAllGlobals());

  it('plans, searches several times, sends the progress and the sources as research, and asks for a report', async () => {
    seed();
    const events = await readEvents(await post({ research: true, webSearch: 'off' }));
    await settle();
    const steps = events.filter((e) => e.event === 'status').map((e) => e.data.step);
    expect(steps[0]).toBe('planning');
    expect(steps).toContain('researching');
    expect(steps.at(-1)).toBe('searched');
    const plan = events.find((e) => e.event === 'status' && e.data.step === 'researching')!.data as { queries: string[]; done: number };
    expect(plan.queries).toEqual(['Who won the 2026 final?', 'final result 2026', 'final scorecard']);
    expect(searches).toHaveLength(3);
    const sources = events.find((e) => e.event === 'sources')!.data as { via: string; items: Source[]; queries: string[] };
    expect(sources.via).toBe('research');
    expect(sources.items).toHaveLength(3);
    expect(sources.queries).toEqual(plan.queries);
    expect((events[0].data as { research?: boolean }).research).toBe(true);
    // The report rules follow the search results in the prompt; the reply is saved with its sources.
    expect(sent[0].messages[0].content).toContain('<search_results>');
    expect(sent[0].messages[0].content).toContain(RESEARCH_RULES);
    expect(fake.rows('ai_messages')[1]).toMatchObject({ role: 'assistant', sources: { via: 'research' } });
    // One from the person's research allowance, then one search each.
    expect(takes.map((t) => t.p_kind)).toEqual(['research:1001', 'search', 'search', 'search']);
    expect(takes[0]).toMatchObject({ p_limit: 10 });
  });

  it('with today’s research used up it says so and searches once, like any turn', async () => {
    seed();
    allow = (kind) => !kind.startsWith('research:');
    const events = await readEvents(await post({ research: true, webSearch: 'on' }));
    await settle();
    const steps = events.filter((e) => e.event === 'status').map((e) => e.data.step);
    expect(steps).toEqual(['research_limit', 'searching', 'searched']);
    expect(searches).toHaveLength(1);
    expect((events.find((e) => e.event === 'sources')!.data as { via: string }).via).toBe('search');
    expect(sent[0].messages[0].content).not.toContain(RESEARCH_RULES);
  });

  it('the owner can switch Research off (researchPerDay 0) or search off; then research is an ordinary message', async () => {
    seed({ enabled: true, limits: { researchPerDay: 0 } });
    const events = await readEvents(await post({ research: true, webSearch: 'off' }));
    await settle();
    expect(events.filter((e) => e.event === 'status')).toEqual([]);
    expect(searches).toHaveLength(0);
    expect(takes).toEqual([]);
  });

  it('GET /api/ai/models says whether Research is offered', async () => {
    seed();
    const get = async (env: Record<string, unknown>) => (await (await modelsGet({ request: new Request('https://www.vinaxmusic.online/api/ai/models', { headers: { 'cf-connecting-ip': `203.0.113.${++ip % 250}` } }), env: env as never })).json()) as { research: boolean; search: boolean };
    expect((await get(ENV)).research).toBe(true);
    expect((await get({ ...ENV, SEARCH_API_KEY: '' })).research).toBe(false);
    resetSettingsMemo();
    seed({ enabled: true, limits: { researchPerDay: 0 } });
    expect((await get(ENV))).toMatchObject({ search: true, research: false });
  });
});
