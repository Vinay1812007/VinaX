import { describe, expect, it } from 'vitest';
import { MAX_STEPS, cleanStep, initialStreamState, reduceFrame, reduceSteps, splitFrames, summariseSteps, type StreamState } from './streamReducer';

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

  it('takes sources and the answering model from meta, latest wins', () => {
    const s = run([
      { meta: { model: 'first-model', sources: [] } },
      { delta: 'x' },
      { meta: { model: 'rescue-model', sources: ['https://a.example', 7, '', 'https://b.example'] } },
    ]);
    expect(s.model).toBe('rescue-model');
    expect(s.sources).toEqual(['https://a.example', 'https://b.example']);
  });

  it('keeps earlier sources when a later meta reports none', () => {
    const s = run([{ meta: { model: 'm', sources: ['https://a.example'] } }, { meta: { model: 'm', sources: [] } }]);
    expect(s.sources).toEqual(['https://a.example']);
  });

  it('records the cut-short notice and the end of the stream', () => {
    const s = run([{ delta: 'half an ans' }, { done: true, truncated: true }]);
    expect(s).toMatchObject({ done: true, truncated: true, text: 'half an ans' });
    expect(run([{ done: true }]).truncated).toBe(false);
  });

  it('collects agent steps beside the text', () => {
    const s = run([
      { step: { tool: 'search', label: 'Searched the web for “x”' } },
      { delta: 'Answer' },
      { step: { tool: 'code', label: 'Ran code' } },
    ]);
    expect(s.steps.map((x) => x.tool)).toEqual(['search', 'code']);
    expect(s.text).toBe('Answer');
  });

  it('skips malformed frames without losing the reply', () => {
    const s = run([{ delta: 'a' }, undefined, null, 'text', 42, ['x'], { delta: 5 }, { meta: 'nope' }, { step: 'nope' }, { delta: 'b' }]);
    expect(s.text).toBe('ab');
    expect(s.malformed).toBe(5);
    expect(s.steps).toEqual([]);
  });

  it('ignores fields it does not know, and returns the same object for a no-op', () => {
    const before = run([{ delta: 'a' }]);
    expect(reduceFrame(before, { somethingNew: true })).toBe(before);
    expect(reduceFrame(before, { delta: '' })).toBe(before);
  });
});

describe('agent steps', () => {
  it('normalises a step: known tool or "other", single line, clipped', () => {
    expect(cleanStep({ tool: 'visit', label: '  Read\n example.com ' })).toEqual({ tool: 'visit', label: 'Read example.com' });
    expect(cleanStep({ tool: 'rm -rf', label: 'x' })).toEqual({ tool: 'other', label: 'x' });
    expect(cleanStep({ tool: 'search', label: 'q'.repeat(400) })?.label).toHaveLength(120);
    expect(cleanStep({ tool: 'search' })).toBeNull();
    expect(cleanStep({ tool: 'search', label: '   ' })).toBeNull();
    expect(cleanStep(null)).toBeNull();
  });

  it('appends newest last, drops an immediate repeat, and stops at the cap', () => {
    let steps = reduceSteps([], { tool: 'search', label: 'a' });
    steps = reduceSteps(steps, { tool: 'search', label: 'a' });
    expect(steps).toHaveLength(1);
    for (let i = 0; i < 40; i += 1) steps = reduceSteps(steps, { tool: 'code', label: `run ${i}` });
    expect(steps).toHaveLength(MAX_STEPS);
    expect(steps[0].label).toBe('a');
    expect(steps[MAX_STEPS - 1].label).toBe(`run ${MAX_STEPS - 2}`);
  });

  it('collapses to a one-line summary', () => {
    expect(
      summariseSteps([
        { tool: 'search', label: 'a' },
        { tool: 'code', label: 'b' },
        { tool: 'search', label: 'c' },
        { tool: 'code', label: 'd' },
      ]),
    ).toBe('Searched the web · ran code · 4 steps');
    expect(summariseSteps([{ tool: 'visit', label: 'a' }])).toBe('Read pages · 1 step');
    expect(summariseSteps([])).toBe('');
  });
});
