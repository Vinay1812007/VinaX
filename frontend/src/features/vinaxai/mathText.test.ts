import { describe, expect, it } from 'vitest';
import { escapeCurrency } from './mathText';

describe('escapeCurrency', () => {
  it.each([
    ['It costs $5 and $10.', 'It costs \\$5 and \\$10.'],
    ['Between $5 and $10 per month', 'Between \\$5 and \\$10 per month'],
    ['Euler: $e^{i\\pi} + 1 = 0$ holds.', 'Euler: $e^{i\\pi} + 1 = 0$ holds.'],
    ['Display $$\\int_0^1 x\\,dx$$ here', 'Display $$\\int_0^1 x\\,dx$$ here'],
    ['Use `echo $HOME` and $x$', 'Use `echo $HOME` and $x$'],
    ['A lone $ sign', 'A lone \\$ sign'],
    ['$x$5 is odd', '\\$x\\$5 is odd'],
    ['no dollars', 'no dollars'],
  ])('%s', (input, want) => {
    expect(escapeCurrency(input)).toBe(want);
  });

  it('leaves fenced code alone', () => {
    const md = '```sh\nprice=$5 and $10\n```\nCost $5 or $6';
    expect(escapeCurrency(md)).toBe('```sh\nprice=$5 and $10\n```\nCost \\$5 or \\$6');
  });
});
