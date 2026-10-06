import { describe, expect, it } from 'vitest';
import { initialStreamState, reduceFrame, splitFrames, type StreamState } from './streamReducer';

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
