import { describe, expect, it } from 'vitest';
import type { Msg } from './types';
import { DIGEST_QUESTIONS, KEEP_TURNS, questionLine, trimThread } from './longThread';

const thread = (n: number): Msg[] =>
  Array.from({ length: n }, (_, i) => (i % 2 === 0 ? { role: 'user' as const, content: `question ${i / 2 + 1}` } : { role: 'assistant' as const, content: `answer ${(i - 1) / 2 + 1}` }));

describe('questionLine', () => {
  it('reduces a turn to one line', () => {
    expect(questionLine('  what is\n\n  a raga?  ')).toBe('what is a raga?');
  });

  it('names attached files rather than quoting their text', () => {
    const content = 'review this\n\n--- File: src/app.ts ---\nconst x = 1;\nlots of code\n';
    const line = questionLine(content);
    expect(line).toContain('review this');
    expect(line).toContain('src/app.ts');
    expect(line).not.toContain('const x = 1');
  });

  it('counts several files and lists the first few', () => {
    const content = 'look\n\n--- File: a.ts ---\nx\n\n--- File: b.ts ---\ny\n\n--- File: c.ts ---\nz\n\n--- File: d.ts ---\nw';
    expect(questionLine(content)).toContain('with 4 files: a.ts, b.ts, c.ts');
  });

  it('says so when a turn was nothing but an attachment', () => {
    expect(questionLine('\n\n--- File: notes.txt ---\nhello')).toContain('an attachment with no question');
  });

  it('clips a very long question', () => {
    const line = questionLine('x'.repeat(500));
    expect(line.length).toBeLessThanOrEqual(141);
    expect(line.endsWith('…')).toBe(true);
  });
});

describe('trimThread', () => {
  it('leaves a short thread exactly as it is', () => {
    const short = thread(10);
    const out = trimThread(short);
    expect(out.turns).toEqual(short);
    expect(out.digest).toBe('');
    expect(out.dropped).toBe(0);
  });

  it('keeps the recent window and digests what fell outside it', () => {
    const long = thread(80);
    const out = trimThread(long);
    expect(out.turns).toHaveLength(KEEP_TURNS);
    // The window is the END of the conversation.
    expect(out.turns[out.turns.length - 1]).toEqual(long[long.length - 1]);
    expect(out.dropped).toBe(80 - KEEP_TURNS);
    expect(out.digest).toContain('EARLIER IN THIS CONVERSATION');
    expect(out.digest).toContain(`${80 - KEEP_TURNS} turns are no longer in context`);
  });

  it('lists only the listener’s questions, oldest first, and never the answers', () => {
    const out = trimThread(thread(80));
    const listed = out.digest.split('\n').filter((l) => /^\d+\. /.test(l));
    expect(listed.length).toBeGreaterThan(0);
    // Every listed line is one of the listener's questions; no reply text leaks in.
    for (const line of listed) {
      expect(line).toMatch(/^\d+\. question \d+$/);
      expect(line).not.toContain('answer');
    }
    const numbers = listed.map((l) => Number(l.split('.')[0]));
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
  });

  it('caps how many questions it lists, and says how many it left out', () => {
    const out = trimThread(thread(200));
    const listed = [...out.digest.matchAll(/^\d+\. /gm)].length;
    expect(listed).toBe(DIGEST_QUESTIONS);
    expect(out.digest).toMatch(/older ones? not listed/);
  });

  it('tells the model the answers are gone and must not be restated', () => {
    const digest = trimThread(thread(80)).digest;
    expect(digest).toMatch(/answers you gave are NOT included/i);
    expect(digest).toMatch(/do not restate them/i);
    expect(digest).toMatch(/history, not the current request/i);
  });

  it('never sends a failed turn back, digested or verbatim', () => {
    const withFailure: Msg[] = [...thread(80)];
    withFailure[0] = { role: 'user', content: 'the first question' };
    withFailure[1] = { role: 'assistant', content: 'VinaX AI could not answer', failed: true };
    const out = trimThread(withFailure);
    expect(out.digest).not.toContain('could not answer');
    expect(out.turns.some((m) => m.failed)).toBe(false);
  });

  it('digests nothing when the dropped turns held no questions', () => {
    const assistantOnly: Msg[] = Array.from({ length: 80 }, () => ({ role: 'assistant' as const, content: 'a' }));
    const out = trimThread(assistantOnly);
    expect(out.digest).toBe('');
    expect(out.dropped).toBe(80 - KEEP_TURNS);
  });

  it('honours a caller’s own window', () => {
    expect(trimThread(thread(80), 10).turns).toHaveLength(10);
  });
});
