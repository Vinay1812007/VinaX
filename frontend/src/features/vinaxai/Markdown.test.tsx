// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
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

  it('renders GFM: tables, task lists, strikethrough, and code blocks with a language label and Copy', () => {
    const c = html('| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n\n~~old~~\n\n```python\nprint("hi")\n```');
    expect(c.querySelector('table td')?.textContent).toBe('1');
    expect(c.querySelector('input[type="checkbox"]')).not.toBeNull();
    expect(c.querySelector('del')?.textContent).toBe('old');
    expect(c.querySelector('.vx-ai-code-lang')?.textContent).toBe('python');
    expect(c.querySelector('pre code')?.textContent).toBe('print("hi")');
    expect(c.querySelector('button[aria-label="Copy code"]')).not.toBeNull();
  });

  it('safeUrl', () => {
    expect(safeUrl('  https://a.b/c ')).toBe('https://a.b/c');
    expect(safeUrl('JavaScript:alert(1)')).toBe('');
    expect(safeUrl('vbscript:x')).toBe('');
    expect(safeUrl('//evil.example')).toBe('');
  });
});
