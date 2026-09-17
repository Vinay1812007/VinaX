/** Locks the auto-web-search trigger (v3.3.0): questions naming the CURRENT
 *  year must ground themselves in live results — the old 202[7-9] pattern
 *  quietly skipped 2026, so "best films of 2026" answered from stale memory. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LANE_BY_MODE, MAX_AGENT_STEPS, createAgentStepCollector, needsFreshInfo, onRequestPost, sanitiseAgentStep } from './vinaxai';
import { resetCatalogCache } from '../_lib/catalog';
import { LANE_BASE, LANE_MODEL } from '../_lib/ai';

describe('needsFreshInfo', () => {
  it('triggers on the current year (2026), not just future years', () => {
    expect(needsFreshInfo('what are the best telugu films of 2026?')).toBe(true);
    expect(needsFreshInfo('top releases 2027')).toBe(true);
  });

  it('triggers on classic recency phrasings', () => {
    expect(needsFreshInfo('who won the match today?')).toBe(true);
    expect(needsFreshInfo('latest AR Rahman album')).toBe(true);
    expect(needsFreshInfo('box office this week')).toBe(true);
  });

  it('stays off for timeless questions', () => {
    expect(needsFreshInfo('explain how a chorus differs from a refrain')).toBe(false);
    expect(needsFreshInfo('suggest calm telugu melodies')).toBe(false);
  });
});

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

describe('4.13 productivity persona', () => {
  const src = readFileSync(resolve(__dirname, './vinaxai.ts'), 'utf8');

  it('appends PRODUCTIVITY DEFAULT to the shared system prompt (all seats inherit it)', () => {
    expect(src).toContain('PRODUCTIVITY DEFAULT (v4.13)');
    expect(src).toMatch(/Bias toward doing, not describing/);
    expect(src).toMatch(/deliver the finished artifact first/);
  });

  it('keeps the refusal shape and prompt-injection guard downstream — clause is INSIDE the shared prompt', () => {
    const promptIdx = src.indexOf('PRODUCTIVITY DEFAULT (v4.13)');
    const injectIdx = src.indexOf('PROMPT INJECTION\n');
    const refuseIdx = src.indexOf('REFUSAL SHAPE');
    expect(promptIdx).toBeGreaterThan(refuseIdx);
    expect(injectIdx).toBeGreaterThan(promptIdx);
  });
});

/**
 * v7.1 — agent steps. An agentic engine reports its tool runs on the stream;
 * the Worker forwards a compact summary as additive `step` frames. The
 * sanitiser is the boundary: raw tool output, code and full URLs stay here.
 */
describe('agent step frames', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetCatalogCache();
  });

  it('reduces a tool run to a tool kind and a short label', () => {
    expect(sanitiseAgentStep({ type: 'search', arguments: JSON.stringify({ query: 'telugu releases this week' }), output: 'RAW RESULT BLOB' })).toEqual({
      tool: 'search',
      label: 'Searched the web for “telugu releases this week”',
    });
    expect(sanitiseAgentStep({ type: 'python', arguments: '{"code":"print(open(\'/etc/passwd\').read())"}', output: 'root:x:0' })).toEqual({ tool: 'code', label: 'Ran code' });
    expect(sanitiseAgentStep({ type: 'function', function: { name: 'web_search', arguments: { q: 'x' } } })?.tool).toBe('search');
    expect(sanitiseAgentStep({ name: 'mystery_tool', arguments: '{"secret":"abc"}' })).toEqual({ tool: 'other', label: 'Used a tool' });
    expect(sanitiseAgentStep(null)).toBeNull();
    expect(sanitiseAgentStep({ output: 'no kind at all' })).toBeNull();
  });

  it('never forwards credentials, paths, query strings, control characters or raw output', () => {
    const visit = sanitiseAgentStep({ type: 'visit', arguments: JSON.stringify({ url: 'https://user:hunter2@www.example.com/private/path?token=abc#frag' }), output: 'page text' });
    expect(visit).toEqual({ tool: 'visit', label: 'Read example.com' });
    const search = sanitiseAgentStep({ type: 'search', arguments: JSON.stringify({ query: 'see\u0000 https://me:pw@host.test/a?k=v\n\tnow' }) });
    expect(search?.label).toBe('Searched the web for “see host.test now”');
    for (const s of [visit, search]) {
      expect(JSON.stringify(s)).not.toMatch(/hunter2|token=|pw@|private|page text/);
    }
    expect(sanitiseAgentStep({ type: 'visit', arguments: '{"url":"javascript:alert(1)"}' })).toEqual({ tool: 'visit', label: 'Opened a page' });
    expect(sanitiseAgentStep({ type: 'visit', arguments: 'not json' })).toEqual({ tool: 'visit', label: 'Opened a page' });
  });

  it('clips a label to 120 characters', () => {
    const long = sanitiseAgentStep({ type: 'search', arguments: JSON.stringify({ query: 'q'.repeat(500) }) });
    expect(long?.label.length).toBeLessThanOrEqual(120);
    expect(long?.label.endsWith('”')).toBe(true);
  });

  it('de-duplicates a run announced twice and stops at the cap', () => {
    const c = createAgentStepCollector();
    const chunk = (rows: unknown[]) => ({ choices: [{ delta: { executed_tools: rows } }] });
    const started = chunk([{ index: 0, type: 'search', arguments: '{"query":"a"}' }]);
    const finished = chunk([{ index: 0, type: 'search', arguments: '{"query":"a"}', output: 'big blob' }]);
    expect(c.collect(started)).toHaveLength(1);
    expect(c.collect(finished)).toHaveLength(0);
    const flood = chunk(Array.from({ length: 40 }, (_, i) => ({ index: i + 1, type: 'search', arguments: JSON.stringify({ query: `q${i}` }) })));
    expect(c.collect(flood)).toHaveLength(MAX_AGENT_STEPS - 1);
    expect(c.collect(chunk([{ index: 99, type: 'python' }]))).toEqual([]);
    expect(c.count()).toBe(MAX_AGENT_STEPS);
    expect(MAX_AGENT_STEPS).toBe(12);
  });

  it('also reads the final message, and ignores everything that is not a tool run', () => {
    const c = createAgentStepCollector();
    expect(c.collect({ choices: [{ message: { content: 'hi', executed_tools: [{ type: 'python' }] } }] })).toEqual([{ tool: 'code', label: 'Ran code' }]);
    for (const junk of [null, 'x', {}, { choices: [] }, { choices: [{ delta: { content: 'plain text' } }] }, { choices: [{ delta: { executed_tools: 'nope' } }] }]) {
      expect(c.collect(junk)).toEqual([]);
    }
  });

  /** End to end through the real handler, upstream mocked: no network. */
  const runChat = async (upstreamSse: string, ip: string): Promise<Array<Record<string, unknown>>> => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string | URL | Request) => {
        const u = String(url instanceof Request ? url.url : url);
        if (u.endsWith('/models')) return Promise.resolve(new Response(JSON.stringify({ data: [{ id: 'vendor/compound' }] }), { status: 200 }));
        return Promise.resolve(new Response(upstreamSse, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
      }),
    );
    const res = await onRequestPost({
      request: new Request('https://x.test/api/vinaxai', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
        body: JSON.stringify({ mode: 'scholar', model: 'vendor/compound', messages: [{ role: 'user', content: 'what changed today?' }] }),
      }),
      env: { VINAX_GROQ_API_KEY: 'k' },
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    return text
      .split('\n\n')
      .filter((f) => f.startsWith('data:'))
      .map((f) => JSON.parse(f.slice(5)) as Record<string, unknown>);
  };
  const up = (o: unknown): string => `data: ${JSON.stringify(o)}\n\n`;

  it('forwards sanitised step frames beside the text for an agentic reply', async () => {
    const frames = await runChat(
      up({ choices: [{ delta: { executed_tools: [{ index: 0, type: 'search', arguments: '{"query":"today"}' }] } }] }) +
        up({ choices: [{ delta: { executed_tools: [{ index: 0, type: 'search', arguments: '{"query":"today"}', output: 'SECRET RAW OUTPUT' }] } }] }) +
        up({ choices: [{ delta: { executed_tools: [{ index: 1, type: 'visit', arguments: '{"url":"https://a:b@news.example.org/x?y=1"}' }] } }] }) +
        up({ choices: [{ delta: { content: 'Here is what changed.' } }] }) +
        'data: [DONE]\n\n',
      '10.7.0.1',
    );
    const steps = frames.filter((f) => 'step' in f).map((f) => f.step);
    expect(steps).toEqual([
      { tool: 'search', label: 'Searched the web for “today”' },
      { tool: 'visit', label: 'Read news.example.org' },
    ]);
    expect(JSON.stringify(frames)).not.toMatch(/SECRET RAW OUTPUT|a:b@/);
    expect(frames.filter((f) => typeof f.delta === 'string').map((f) => f.delta).join('')).toBe('Here is what changed.');
    expect(frames[frames.length - 1]).toEqual({ done: true });
  });

  it('leaves a reply without tool runs exactly as before: meta, deltas, done', async () => {
    const frames = await runChat(up({ choices: [{ delta: { content: 'Plain ' } }] }) + up({ choices: [{ delta: { content: 'answer.' } }] }) + 'data: [DONE]\n\n', '10.7.0.2');
    expect(frames.some((f) => 'step' in f)).toBe(false);
    expect(frames.map((f) => Object.keys(f)[0])).toEqual(['meta', 'delta', 'delta', 'done']);
  });
});
