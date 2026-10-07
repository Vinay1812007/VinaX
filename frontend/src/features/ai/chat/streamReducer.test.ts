import { describe, expect, it } from 'vitest';
import { initialStreamState, readSources, reduceFrame, splitFrames, type StreamState } from './streamReducer';

const run = (frames: unknown[], from: StreamState = initialStreamState()): StreamState => frames.reduce<StreamState>(reduceFrame, from);

describe('splitFrames', () => {
  it('returns complete frames and carries the unfinished tail', () => {
    const a = splitFrames('data: {"delta":"Hel"}\n\ndata: {"del');
    expect(a.frames).toEqual([{ delta: 'Hel' }]);
    expect(a.rest).toBe('data: {"del');
    const b = splitFrames(`${a.rest}ta":"lo"}\n\n`);
    expect(b.frames).toEqual([{ delta: 'lo' }]);
    expect(b.rest).toBe('');
  });

  it('drops comments, keep-alives and the [DONE] sentinel; tolerates CRLF', () => {
    const { frames } = splitFrames(': ping\n\nevent: x\n\ndata: [DONE]\n\ndata:\n\ndata: {"done":true}\r\n\r\n');
    expect(frames).toEqual([{ done: true }]);
  });

  it('reports a payload that is not JSON as an undefined frame', () => {
    expect(splitFrames('data: {oops\n\n').frames).toEqual([undefined]);
  });
});

describe('reduceFrame', () => {
  it('concatenates deltas in order', () => {
    expect(run([{ delta: 'Hello' }, { delta: ', ' }, { delta: 'world' }]).text).toBe('Hello, world');
  });

  it('takes the answering model from meta, latest wins', () => {
    const s = run([{ meta: { model: 'first-model' } }, { delta: 'x' }, { meta: { model: 'rescue-model' } }]);
    expect(s.model).toBe('rescue-model');
  });

  it('10.3 — takes the original name, slug and provider from meta, and a failover hop replaces all three', () => {
    const s = run([
      { meta: { model: 'Alpha 70B', modelId: 'lab/alpha-70b', provider: 'nvidia', mode: 'model' } },
      { delta: 'x' },
      { meta: { model: 'Small 8B', modelId: 'small-8b', provider: 'groq', mode: 'model' } },
    ]);
    expect(s).toMatchObject({ model: 'Small 8B', modelId: 'small-8b', provider: 'groq' });
    // An older server's meta (an opaque label, nothing else) clears what it cannot vouch for.
    expect(run([{ meta: { model: 'A', modelId: 'a', provider: 'nvidia' } }, { meta: { model: 'VinaX AI' } }])).toMatchObject({ model: 'VinaX AI', modelId: '', provider: '' });
  });

  it('ignores the retired fields an older server still sends (sources, previews, step frames)', () => {
    const s = run([
      { meta: { model: 'm', web: 'on', sources: ['https://a.example'], previews: [{ url: 'https://a.example', title: 'T', snippet: 's' }] } },
      { step: { tool: 'search', label: 'x' } },
      { delta: 'Answer' },
    ]);
    expect(s).toEqual({ ...initialStreamState(), model: 'm', text: 'Answer' });
  });

  it('records the cut-short notice and the end of the stream', () => {
    const s = run([{ delta: 'half an ans' }, { done: true, truncated: true }]);
    expect(s).toMatchObject({ done: true, truncated: true, text: 'half an ans' });
    expect(run([{ done: true }]).truncated).toBe(false);
  });

  it('skips malformed frames without losing the reply', () => {
    const s = run([{ delta: 'a' }, undefined, null, 'text', 42, ['x'], { delta: 5 }, { meta: 'nope' }, { step: 'nope' }, { delta: 'b' }]);
    expect(s.text).toBe('ab');
    expect(s.malformed).toBe(5);
  });

  it('ignores fields it does not know, and returns the same object for a no-op', () => {
    const before = run([{ delta: 'a' }]);
    expect(reduceFrame(before, { somethingNew: true })).toBe(before);
    expect(reduceFrame(before, { delta: '' })).toBe(before);
  });
});

describe('10.3 — tools in meta', () => {
  it('records the tools that were on for the answering model, and a failover hop replaces them', () => {
    const s = run([{ meta: { model: 'Alpha 70B', modelId: 'lab/alpha-70b', provider: 'nvidia', tools: ['code_execution', 7] } }, { delta: 'x' }]);
    expect(s.tools).toEqual(['code_execution']);
    const hop = run([{ meta: { model: 'Alpha 70B', provider: 'nvidia', tools: ['code_execution'] } }, { meta: { model: 'Small 8B', provider: 'groq' } }]);
    expect(hop.tools).toEqual([]);
    expect(run([{ meta: { model: 'Small 8B', tools: 'nope' } }]).tools).toEqual([]);
  });
});

describe('11.0 — the sources event', () => {
  const run = (frames: unknown[]): StreamState => frames.reduce<StreamState>((s, f) => reduceFrame(s, f), initialStreamState());
  it('keeps validated sources (http(s) only, de-duplicated, at most 8, titles clipped) and the snippet', () => {
    const items = [
      { url: 'https://a.example/x', title: 'A' },
      { url: 'https://a.example/x', title: 'dup' },
      { url: 'javascript:alert(1)', title: 'bad' },
      { url: 'https://b.example/y', title: 'b'.repeat(150) },
      ...Array.from({ length: 10 }, (_, i) => ({ url: `https://c.example/${i}`, title: `c${i}` })),
    ];
    const s = run([{ meta: { model: 'Gemini 2.5 Flash', modelId: 'gemini-2.5-flash', provider: 'gemini', tools: ['web_search'] } }, { delta: 'x' }, { sources: { items, queries: ['q1'], entry: '<div>s</div>' } }, { done: true }]);
    expect(s.tools).toEqual(['web_search']);
    expect(s.sources?.items).toHaveLength(8);
    expect(s.sources?.items[0]).toEqual({ url: 'https://a.example/x', title: 'A' });
    expect(s.sources?.items[1].title).toHaveLength(120);
    expect(s.sources?.items.some((i) => i.url.startsWith('javascript:'))).toBe(false);
    expect(s.sources?.queries).toEqual(['q1']);
    expect(s.sources?.entry).toBe('<div>s</div>');
    expect(s.text).toBe('x');
    expect(s.done).toBe(true);
  });
  it('ignores an empty or malformed sources payload, and a reply without one has none', () => {
    expect(run([{ sources: { items: [], queries: [], entry: null } }]).sources).toBeNull();
    expect(run([{ sources: 'nope' }]).sources).toBeNull();
    expect(run([{ delta: 'hi' }, { done: true }]).sources).toBeNull();
    expect(readSources({ items: [{ url: 'https://a.example' }] })).toEqual({ items: [{ url: 'https://a.example', title: '' }], queries: [], entry: null });
  });
});
