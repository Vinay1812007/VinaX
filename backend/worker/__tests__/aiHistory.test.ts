/** VinaX AI — the message tree and history trimming. */
import { describe, expect, it } from 'vitest';
import { clipMiddle, fallbackTitle, latestLeaf, pathTo, toNormalized, trimHistory, type TreeMessage } from '../functions/_lib/ai/history';

const msg = (id: string, parent: string | null, role: 'user' | 'assistant', text: string, at: string): TreeMessage => ({ id, parent_id: parent, role, content: [{ type: 'text', text }], created_at: at });
// u1 → a1 → u2 → a2, and an edit u2b (sibling of u2) → a2b
const tree = [
  msg('u1', null, 'user', 'q1', '1'), msg('a1', 'u1', 'assistant', 'r1', '2'),
  msg('u2', 'a1', 'user', 'q2', '3'), msg('a2', 'u2', 'assistant', 'r2', '4'),
  msg('u2b', 'a1', 'user', 'q2 edited', '5'), msg('a2b', 'u2b', 'assistant', 'r2b', '6'),
];

describe('message tree', () => {
  it('walks a branch from the root', () => {
    expect(pathTo(tree, 'a2').map((m) => m.id)).toEqual(['u1', 'a1', 'u2', 'a2']);
    expect(pathTo(tree, 'a2b').map((m) => m.id)).toEqual(['u1', 'a1', 'u2b', 'a2b']);
    expect(pathTo(tree, 'missing')).toEqual([]);
  });
  it('survives a cycle', () => {
    expect(pathTo([msg('x', 'y', 'user', '', '1'), msg('y', 'x', 'user', '', '2')], 'x')).toHaveLength(2);
  });
  it('the latest leaf is the newest childless message', () => {
    expect(latestLeaf(tree)?.id).toBe('a2b');
  });
  it('joins two turns in a row from the same side and drops empty ones', () => {
    const p = [msg('u1', null, 'user', 'first', '1'), msg('u2', 'u1', 'user', 'second', '2'), msg('a', 'u2', 'assistant', '  ', '3')];
    expect(toNormalized(p)).toEqual([{ role: 'user', text: 'first\n\nsecond' }]);
  });
});

describe('trimHistory', () => {
  const turns = [
    { role: 'user' as const, text: 'a'.repeat(100) }, { role: 'assistant' as const, text: 'b'.repeat(100) },
    { role: 'user' as const, text: 'c'.repeat(100) }, { role: 'assistant' as const, text: 'd'.repeat(100) },
    { role: 'user' as const, text: 'latest' },
  ];
  it('keeps the newest turns that fit and never starts on an assistant turn', () => {
    const kept = trimHistory(turns, 150); // fits "latest" and d…, but d… is an answer whose question was cut
    expect(kept[0].role).toBe('user');
    expect(kept.at(-1)?.text).toBe('latest');
    expect(kept.map((t) => t.text[0])).toEqual(['l']);
    expect(trimHistory(turns, 10_000)).toHaveLength(5);
    expect(trimHistory(turns, 220).map((t) => t.text[0])).toEqual(['c', 'd', 'l']);
  });
  it('always keeps the latest turn, clipped from the middle when it alone is too long', () => {
    const kept = trimHistory([{ role: 'user', text: 'x'.repeat(5_000) + 'END' }], 1_000);
    expect(kept).toHaveLength(1);
    expect(kept[0].text.length).toBeLessThanOrEqual(1_000);
    expect(kept[0].text.endsWith('END')).toBe(true);
    expect(clipMiddle('short', 100)).toBe('short');
  });
});

describe('fallbackTitle', () => {
  it('takes up to six words', () => {
    expect(fallbackTitle('  Tell me   about the history of Carnatic music please ')).toBe('Tell me about the history of');
    expect(fallbackTitle('')).toBe('New chat');
    expect(fallbackTitle('x'.repeat(100)).length).toBeLessThanOrEqual(58);
  });
});
