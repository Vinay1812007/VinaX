// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const diagram = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async () => ({ svg: '<svg data-testid="diagram"></svg>' })),
}));
vi.mock('mermaid', () => ({ default: diagram }));
// Feature flags come from a query the page provides; every flag reads as on here.
vi.mock('@/features/home/useAppConfig', () => ({ useFeatureFlags: () => ({}), flagOn: () => true }));

import { RichContent } from './RichContent';

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('light');
  diagram.initialize.mockClear();
});

const show = (text: string): HTMLElement => render(<RichContent text={text} streaming />).container;
/** Inline maths renders as raw TeX in a mono span until the engine loads, then as engine markup. */
const maths = (el: HTMLElement): number => el.querySelectorAll('span.font-mono, .katex').length;

describe('RichContent block parser always terminates', () => {
  // Each of these froze the tab before the fix: no branch consumed the line.
  const FROZE = [
    '- [ ] ',
    '- [ ]',
    '- [x]',
    '* [X]',
    '- [x]done',
    'Shopping list:\n- [ ] ',
    '- [x] milk\n- [ ]',
    '- [ ] one\n- [x]done\n- two',
    '# title\rwith a stray return',
    '## title\u2028with a line separator',
  ];
  it.each(FROZE)('renders %j without hanging', (text) => {
    const started = Date.now();
    const el = show(text);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(el.querySelector('.ai-rich')).not.toBeNull();
  }, 5000);

  it('shows a bare checkbox as an empty checklist row and keeps its neighbours', () => {
    const el = show('- [x] milk\n- [ ]');
    const rows = el.querySelectorAll('ul > li');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('milk');
    expect(rows[0].textContent).toContain('✓');
    expect(rows[1].textContent).toBe('');
  });

  it('treats "- [x]done" as an ordinary bullet, not a checklist row', () => {
    const el = show('- [x]done');
    expect(el.textContent).toContain('[x]done');
  });

  it('keeps the whole heading when it carries a stray carriage return', () => {
    const el = show('# title\rtail');
    expect(el.querySelector('p.font-bold')?.textContent).toBe('title\rtail');
  });

  it('terminates on random markdown-ish input and never drops a word', () => {
    // Deterministic generator, so a failure is reproducible from the seed.
    let seed = 0x2f6e2b1;
    const rnd = (n: number): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % n;
    };
    const PARTS = [
      '-', '*', '+', '- ', '* ', '+ ', '[ ]', '[x]', '[X]', '[]', '[ ] ', '#', '# ', '###### ', '>', '> ',
      '|', ' | ', '---', '|---|', '***', '___', '$$', '$', '1.', '1. ', '12. ', ' ', '  ', '\t', '\r',
      '\u2028', 'word', 'done', '`', '~~', '**', '(', ')', '](http://a.b/c', '[t',
    ];
    const started = Date.now();
    for (let doc = 0; doc < 400; doc += 1) {
      const lines: string[] = [];
      const lineCount = 1 + rnd(6);
      for (let l = 0; l < lineCount; l += 1) {
        let line = '';
        const parts = rnd(6);
        for (let k = 0; k < parts; k += 1) line += PARTS[rnd(PARTS.length)];
        lines.push(line);
      }
      const text = lines.join('\n');
      const el = show(text);
      expect(el.querySelector('.ai-rich'), JSON.stringify(text)).not.toBeNull();
      // A word may legitimately leave the visible text inside maths or a link
      // address; everywhere else, losing one means a line was swallowed.
      if (!text.includes('$') && !text.includes('](')) {
        const want = (text.match(/word|done/g) ?? []).length;
        const got = (el.querySelector('.ai-rich')?.textContent?.match(/word|done/g) ?? []).length;
        expect(got, JSON.stringify(text)).toBeGreaterThanOrEqual(want);
      }
      cleanup();
    }
    expect(Date.now() - started).toBeLessThan(20000);
  }, 30000);
});

describe('RichContent inline markdown', () => {
  it('keeps balanced parentheses inside a link address', () => {
    const el = show('See [the article](https://example.org/wiki/Raga_(music)) for more.');
    const a = el.querySelector('a');
    expect(a?.getAttribute('href')).toBe('https://example.org/wiki/Raga_(music)');
    expect(a?.textContent).toBe('the article');
    expect(el.textContent).toBe('See the article for more.');
  });

  it('still renders a plain link, and a link wrapped in parentheses', () => {
    const el = show('Read [docs](https://example.org/a?b=1&c=2) (or [this](https://example.org/x)).');
    const links = [...el.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(links).toEqual(['https://example.org/a?b=1&c=2', 'https://example.org/x']);
    expect(el.textContent).toBe('Read docs (or this).');
  });

  it('leaves prices alone', () => {
    for (const text of ['Tickets are $20 and $35 at the door.', 'From $5-$10 each.', 'It costs $20, or $35 with a poster.']) {
      const el = show(text);
      expect(maths(el), text).toBe(0);
      expect(el.textContent).toBe(text);
      cleanup();
    }
  });

  it('still renders inline maths', () => {
    // 11.0 — an amount, plain words, then a trailing dollar: two prices.
    for (const text of ['Add a $5 fee and a 10$ tip.', 'A $5 fee and a 10$ tip, where $x^2$ is the area.']) {
      const money = show(text);
      expect(money.textContent).toContain('$5 fee and a 10$ tip');
      cleanup();
    }
    // 11.0 — display maths mid-sentence must not put a block inside the paragraph.
    const mid = show('So $$\\int f$$ holds, $3 x + 1$ and $5 cm$ too.');
    expect(mid.querySelector('p div')).toBeNull();
    expect(mid.textContent).not.toContain('$');
    cleanup();
    const el = show('The area is $x^2$ exactly, and $a + b$ too.');
    expect(maths(el)).toBeGreaterThanOrEqual(2);
    expect(el.textContent).not.toContain('$');
  });

  it('keeps the asterisks of a multiplication', () => {
    for (const text of ['5*4*3 is sixty', '2 * 3 * 4 = 24', 'a*b*c']) {
      const el = show(text);
      expect(el.querySelector('em'), text).toBeNull();
      expect(el.textContent).toBe(text);
      cleanup();
    }
  });

  it('still renders emphasis, bold, strike-through and inline code', () => {
    const el = show('An *emphasised phrase*, a **bold one**, a ~~struck one~~ and `code`.');
    expect(el.querySelector('em')?.textContent).toBe('emphasised phrase');
    expect(el.querySelector('strong')?.textContent).toBe('bold one');
    expect(el.querySelector('del')?.textContent).toBe('struck one');
    expect(el.querySelector('code')?.textContent).toBe('code');
  });
});

describe('RichContent in the light theme', () => {
  it('draws a diagram with the light palette on the light theme', async () => {
    document.documentElement.classList.add('light');
    render(<RichContent text={'```mermaid\ngraph TD; A-->B;\n```'} />);
    await waitFor(() => expect(diagram.initialize).toHaveBeenCalled());
    expect(diagram.initialize.mock.calls[0][0]).toMatchObject({ theme: 'default', securityLevel: 'strict' });
  });

  it('keeps the dark palette on the dark themes', async () => {
    render(<RichContent text={'```mermaid\ngraph TD; A-->B;\n```'} />);
    await waitFor(() => expect(diagram.initialize).toHaveBeenCalled());
    expect(diagram.initialize.mock.calls[0][0]).toMatchObject({ theme: 'dark' });
  });
});
