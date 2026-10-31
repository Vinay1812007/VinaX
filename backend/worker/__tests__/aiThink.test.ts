/** VinaX AI — the <think> normaliser and the SSE line reader. */
import { describe, expect, it } from 'vitest';
import { THINK_MAX, ThinkSplitter } from '../functions/_lib/ai/think';
import { sseData, sseFrame } from '../functions/_lib/ai/sse';
import type { ProviderEvent } from '../functions/_lib/ai/types';
import { streamOf } from './helpers/aiStreams';

function run(chunks: string[]): { thinking: string; text: string; split: ThinkSplitter } {
  const split = new ThinkSplitter();
  const events: ProviderEvent[] = [];
  for (const c of chunks) events.push(...split.push(c));
  events.push(...split.end());
  const join = (t: 'thinking' | 'text') => events.filter((e) => e.type === t).map((e) => (e as { delta: string }).delta).join('');
  return { thinking: join('thinking'), text: join('text'), split };
}

/** Every way of cutting `s` into two pieces, plus one char at a time. */
const cuts = (s: string): string[][] => [...Array.from({ length: s.length - 1 }, (_, i) => [s.slice(0, i + 1), s.slice(i + 1)]), s.split('')];

describe('ThinkSplitter', () => {
  it('passes plain text straight through', () => {
    expect(run(['Hello ', 'world'])).toMatchObject({ thinking: '', text: 'Hello world' });
  });

  it('sends a <think> block to thinking and trims the gap after it, however the tags are split', () => {
    const whole = '<think>plan the answer</think>\n\nThe answer.';
    for (const chunks of cuts(whole)) {
      const r = run(chunks);
      expect(r.thinking, JSON.stringify(chunks)).toBe('plan the answer');
      expect(r.text, JSON.stringify(chunks)).toBe('The answer.');
      expect(r.split.sawText).toBe(true);
    }
  });

  it('allows whitespace before the opening tag', () => {
    expect(run(['\n  <think>a</think>b'])).toMatchObject({ thinking: 'a', text: 'b' });
  });

  it('never shows a raw tag in the answer', () => {
    for (const chunks of cuts('<think>x < y</think>ok')) expect(run(chunks).text).not.toMatch(/<\/?think>/);
  });

  it('text that merely starts like a tag is still text', () => {
    expect(run(['<thi', 's is html>'])).toMatchObject({ thinking: '', text: '<this is html>' });
    expect(run(['<'])).toMatchObject({ text: '<' });
  });

  it('counts a stream that ends inside <think> as no answer', () => {
    const r = run(['<think>still thinking']);
    expect(r.thinking).toBe('still thinking');
    expect(r.text).toBe('');
    expect(r.split.sawText).toBe(false);
    expect(r.split.unclosed).toBe(true);
  });

  it('whitespace alone is not an answer', () => {
    expect(run(['  \n']).split.sawText).toBe(false);
  });

  it('takes reasoning from a separate field and caps it', () => {
    const split = new ThinkSplitter();
    const out = [...split.reasoning('a'.repeat(THINK_MAX - 1)), ...split.reasoning('bcd'), ...split.reasoning('e')];
    expect(out.map((e) => (e as { delta: string }).delta).join('').length).toBe(THINK_MAX);
  });
});

describe('sseData', () => {
  it('yields each data payload, skipping [DONE], comments and blank data, across any chunking', async () => {
    const text = ': keep-alive\n\ndata: {"a":1}\r\n\r\nevent: x\ndata: {"b":"é"}\n\ndata: [DONE]\n\ndata: {"c":3}';
    for (const size of [1, 2, 5, 100]) {
      const got: string[] = [];
      for await (const d of sseData(streamOf(text, size))) got.push(d);
      expect(got, `size ${size}`).toEqual(['{"a":1}', '{"b":"é"}', '{"c":3}']);
    }
  });

  it('stops when its signal aborts', async () => {
    const ac = new AbortController();
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode('data: 1\n\n')); } });
    const got: string[] = [];
    for await (const d of sseData(body, ac.signal)) {
      got.push(d);
      ac.abort();
    }
    expect(got).toEqual(['1']);
  });

  it('writes named frames, one JSON object per data line', () => {
    expect(new TextDecoder().decode(sseFrame('text', { delta: 'a\nb' }))).toBe('event: text\ndata: {"delta":"a\\nb"}\n\n');
  });
});
