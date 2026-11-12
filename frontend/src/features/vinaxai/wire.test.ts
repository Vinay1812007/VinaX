import { describe, expect, it } from 'vitest';
import { THINK_MAX, WireReader, wireOf } from './wire';
import type { StreamEvent } from './types';

const read = (r: WireReader, lines: unknown[]): StreamEvent[] => [...lines.flatMap((l) => r.push(typeof l === 'string' ? l : JSON.stringify(l))), ...r.end()];
const joined = (evs: StreamEvent[], kind: 'thinking' | 'text') => evs.filter((e) => e.event === kind).map((e) => (e.data as { delta: string }).delta).join('');
const oa = (delta: Record<string, unknown>) => ({ choices: [{ index: 0, delta }] });

describe('WireReader', () => {
  it('openai: reasoning fields are thinking, content is text; [DONE], usage and error frames add nothing', () => {
    const evs = read(new WireReader('openai'), [oa({ reasoning: 'Plan ' }), oa({ reasoning_content: 'it.' }), oa({ content: 'Kafka ' }), oa({ content: 'partitions.' }), { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1 } }, { error: { message: 'x' } }, '[DONE]', 'not json']);
    expect(joined(evs, 'thinking')).toBe('Plan it.');
    expect(joined(evs, 'text')).toBe('Kafka partitions.');
  });

  it('openai: <think> tags split anywhere become thinking, the answer after them is trimmed', () => {
    const answer = '<think>Round robin vs hash</think>\n\nKafka uses both.';
    for (const size of [1, 2, 5, 9, answer.length]) {
      const parts: unknown[] = [];
      for (let i = 0; i < answer.length; i += size) parts.push(oa({ content: answer.slice(i, i + size) }));
      const evs = read(new WireReader('openai'), parts);
      expect(joined(evs, 'thinking'), `size ${size}`).toBe('Round robin vs hash');
      expect(joined(evs, 'text'), `size ${size}`).toBe('Kafka uses both.');
    }
  });

  it('gemini: thought parts are thinking, the rest is text', () => {
    const evs = read(new WireReader('gemini'), [
      { candidates: [{ content: { parts: [{ text: 'Thinking…', thought: true }] } }] },
      { candidates: [{ content: { parts: [{ text: 'Hello ' }, { text: 'there' }] } }] },
      { candidates: [{ content: { parts: [] }, finishReason: 'STOP', groundingMetadata: {} }] },
    ]);
    expect(joined(evs, 'thinking')).toBe('Thinking…');
    expect(joined(evs, 'text')).toBe('Hello there');
  });

  it('workers-ai: response frames are text', () => {
    const evs = read(new WireReader('workers-ai'), [{ response: 'Hi' }, { response: ' you' }, { reasoning_content: 'hm' }]);
    expect(joined(evs, 'text')).toBe('Hi you');
    expect(joined(evs, 'thinking')).toBe('hm');
  });

  it('keeps at most THINK_MAX characters of reasoning', () => {
    const evs = read(new WireReader('openai'), [oa({ reasoning: 'x'.repeat(THINK_MAX + 50) }), oa({ reasoning: 'more' })]);
    expect(joined(evs, 'thinking')).toHaveLength(THINK_MAX);
  });

  it('wireOf falls back to openai', () => {
    expect(wireOf('gemini')).toBe('gemini');
    expect(wireOf(undefined)).toBe('openai');
    expect(wireOf('evil')).toBe('openai');
  });
});
