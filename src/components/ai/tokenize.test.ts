import { describe, it, expect } from 'vitest';
import { tokenize } from './tokenize';

describe('tokenize', () => {
  it('returns a single prose token for plain text', () => {
    const t = tokenize('Hello there, this is a plain answer.');
    expect(t).toHaveLength(1);
    expect(t[0]).toEqual({ t: 'prose', text: 'Hello there, this is a plain answer.' });
  });

  it('parses a closed fenced block and lowercases the language', () => {
    const t = tokenize('```JS\nconst a = 1;\n```');
    expect(t).toHaveLength(1);
    expect(t[0]).toEqual({ t: 'code', lang: 'js', code: 'const a = 1;', closed: true });
  });

  it('marks an unclosed fence (still streaming) as not closed', () => {
    const t = tokenize('```python\nprint("hi")\nx = 2');
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ t: 'code', lang: 'python', closed: false });
    expect((t[0] as { code: string }).code).toBe('print("hi")\nx = 2');
  });

  it('keeps prose and code in order around a fence', () => {
    const t = tokenize('Intro line.\n```sql\nSELECT 1;\n```\nOutro line.');
    expect(t.map((x) => x.t)).toEqual(['prose', 'code', 'prose']);
    expect(t[0]).toEqual({ t: 'prose', text: 'Intro line.' });
    expect(t[1]).toMatchObject({ lang: 'sql', code: 'SELECT 1;', closed: true });
    expect(t[2]).toEqual({ t: 'prose', text: 'Outro line.' });
  });

  it('handles a fence with no language tag', () => {
    const t = tokenize('```\nplain block\n```');
    expect(t[0]).toEqual({ t: 'code', lang: '', code: 'plain block', closed: true });
  });

  it('produces no code and nothing visible for an empty string', () => {
    const t = tokenize('');
    expect(t.every((x) => x.t === 'prose' && x.text === '')).toBe(true);
  });
});
