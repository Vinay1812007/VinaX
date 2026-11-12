// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { Markdown, safeUrl } from './Markdown';

afterEach(cleanup);
const html = (md: string) => render(<Markdown text={md} />).container;

describe('<Markdown />: model output is untrusted', () => {
  it('shows raw HTML as text, never as elements', () => {
    const c = html('Hello <img src=x onerror="alert(1)"> and <script>alert(2)</script>\n\n<div onclick="x()">block</div>');
    expect(c.querySelector('img, script, div[onclick]')).toBeNull();
    expect(c.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(c.textContent).toContain('<script>');
    expect(c.textContent).toContain('<div onclick="x()">block</div>');
  });

  it('drops javascript:, data: and relative links; keeps web and mail links, opening safely', () => {
    const c = html('[a](javascript:alert(1)) [b](data:text/html,x) [c](/admin) [d](https://example.com) [e](mailto:x@example.com)');
    const links = [...c.querySelectorAll('a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['https://example.com', 'mailto:x@example.com']);
    for (const a of links) {
      expect(a.getAttribute('rel')).toBe('noopener noreferrer nofollow');
      expect(a.getAttribute('target')).toBe('_blank');
    }
    expect(c.textContent).toContain('a b c');
  });

  it('never loads an image: it becomes a link', () => {
    const c = html('![a chart](https://tracker.example/pixel.png)');
    expect(c.querySelector('img')).toBeNull();
    expect(c.querySelector('a')?.getAttribute('href')).toBe('https://tracker.example/pixel.png');
    expect(c.textContent).toContain('a chart');
  });

  it('renders GFM: tables, task lists, strikethrough, and code blocks with a language label and Copy', async () => {
    const c = html('| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n\n~~old~~\n\n```python\nprint("hi")\n```');
    expect(c.querySelector('table td')?.textContent).toBe('1');
    expect(c.querySelector('input[type="checkbox"]')).not.toBeNull();
    expect(c.querySelector('del')?.textContent).toBe('old');
    expect(c.querySelector('.vx-ai-code-lang')?.textContent).toBe('python');
    expect(c.querySelector('pre code')?.textContent).toBe('print("hi")');
    expect(c.querySelector('button[aria-label="Copy code"]')).not.toBeNull();
    // The highlighter arrives lazily; wait for it so no import is left pending when the file ends.
    await waitFor(() => expect(c.querySelector('code.hljs')).not.toBeNull());
  });

  it('renders maths with KaTeX once loaded, and keeps prices as text', async () => {
    const c = html('Euler: $e^{i\\pi}+1=0$. It costs $5 and $10.');
    await waitFor(() => expect(c.querySelector('.katex')).not.toBeNull(), { timeout: 5_000 });
    expect(c.querySelectorAll('.katex')).toHaveLength(1);
    expect(c.textContent).toContain('It costs $5 and $10.');
  });

  it('safeUrl', () => {
    expect(safeUrl('  https://a.b/c ')).toBe('https://a.b/c');
    expect(safeUrl('JavaScript:alert(1)')).toBe('');
    expect(safeUrl('vbscript:x')).toBe('');
    expect(safeUrl('//evil.example')).toBe('');
  });
});

describe('code blocks: Download, Wrap, line numbers', () => {
  it('names the download for its language; numbers blocks of five lines or more, but not while wrapped', async () => {
    const { fileNameFor } = await import('./CodeBlock');
    expect(fileNameFor('Python')).toBe('snippet.py');
    expect(fileNameFor('tsx')).toBe('snippet.tsx');
    expect(fileNameFor('dockerfile')).toBe('Dockerfile');
    expect(fileNameFor('')).toBe('snippet.txt');
    const short = html('```js\nconst a = 1;\n```');
    expect(short.querySelector('.vx-ai-code-gutter')).toBeNull();
    expect(short.querySelector('button[aria-label="Download snippet.js"]')).not.toBeNull();
    cleanup();
    const long = html('```js\na\nb\nc\nd\ne\nf\n```');
    expect(long.querySelector('.vx-ai-code-gutter')?.textContent).toBe('1\n2\n3\n4\n5\n6');
    const wrap = long.querySelector<HTMLButtonElement>('button[aria-label="Wrap long lines"]')!;
    fireEvent.click(wrap);
    expect(wrap.getAttribute('aria-pressed')).toBe('true');
    expect(long.querySelector('.vx-ai-code-gutter')).toBeNull();
    expect(long.querySelector('.vx-ai-code.is-wrapped')).not.toBeNull();
    await waitFor(() => expect(long.querySelector('code.hljs')).not.toBeNull());
  });
});
