// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { splitCitations } from './citations';
import { Markdown } from './Markdown';
import { SourcesRow, statusText } from './Sources';
import type { Source } from './types';

afterEach(cleanup);

const SOURCES: Source[] = [
  { n: 1, url: 'https://www.espncricinfo.com/final', title: 'Final report', site: 'espncricinfo.com', snippet: 'India won by 6 runs.' },
  { n: 2, url: 'https://bbc.com/sport', title: 'BBC Sport', site: 'bbc.com' },
];

describe('splitCitations', () => {
  it('turns [n] into citations only for sources that exist', () => {
    const out = splitCitations('Won.[1][2] See [7] and [0].', 2);
    expect(out.map((n) => (n.type === 'citation' ? `#${n.children?.[0].value}` : n.value))).toEqual(['Won.', '#1', '#2', ' See [7] and [0].']);
    expect(splitCitations('no markers', 2)).toEqual([{ type: 'text', value: 'no markers' }]);
  });
});

describe('<Markdown sources>', () => {
  it('[n] becomes a chip that opens the source safely; code and unknown numbers stay text', () => {
    const { container } = render(<Markdown text={'India won.[1] Also [3].\n\n`arr[1]` and\n\n```\nx[2]\n```'} sources={SOURCES} />);
    const chips = container.querySelectorAll('a.vx-ai-cite');
    expect(chips).toHaveLength(1);
    expect(chips[0].getAttribute('href')).toBe('https://www.espncricinfo.com/final');
    expect(chips[0].getAttribute('rel')).toBe('noopener noreferrer nofollow');
    expect(chips[0].getAttribute('aria-label')).toBe('Source 1: Final report, espncricinfo.com');
    expect(container.textContent).toContain('Also [3].');
    expect(container.querySelector('code')?.textContent).toBe('arr[1]');
    expect(container.querySelector('pre code')?.textContent).toBe('x[2]');
  });

  it('focus shows the source: title, site and snippet', () => {
    render(<Markdown text="India won.[1]" sources={SOURCES} />);
    fireEvent.focus(screen.getByRole('link', { name: /Source 1/ }));
    const tip = screen.getByRole('tooltip');
    expect(tip.textContent).toContain('Final report');
    expect(tip.textContent).toContain('espncricinfo.com');
    expect(tip.textContent).toContain('India won by 6 runs.');
  });

  it('without sources, [1] is plain text', () => {
    const { container } = render(<Markdown text="Item [1]" />);
    expect(container.querySelector('.vx-ai-cite')).toBeNull();
    expect(container.textContent).toBe('Item [1]');
  });
});

describe('<SourcesRow />', () => {
  it('lists every source with a monogram, never loading a favicon', () => {
    const { container } = render(<SourcesRow sources={{ items: SOURCES, via: 'search' }} />);
    expect(screen.getByRole('region', { name: 'Sources' })).toBeTruthy();
    expect([...container.querySelectorAll('li a')].map((a) => a.getAttribute('href'))).toEqual(SOURCES.map((s) => s.url));
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.vx-ai-mono')?.textContent).toBe('E');
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('shows Google’s suggestions in a sandbox without scripts or same-origin', () => {
    const { container } = render(<SourcesRow sources={{ items: SOURCES, via: 'grounding', entryPointHtml: '<div class="chip">india final</div>' }} />);
    const frame = container.querySelector('iframe')!;
    expect(frame.getAttribute('sandbox')).toBe('allow-popups allow-popups-to-escape-sandbox');
    expect(frame.getAttribute('srcdoc')).toContain('<base target="_blank">');
    expect(frame.getAttribute('srcdoc')).toContain('india final');
  });
});

describe('statusText', () => {
  it('says what the search is doing', () => {
    expect(statusText({ step: 'searching', query: 'india final' })).toBe('Searching the web for “india final”');
    expect(statusText({ step: 'searched', count: 6, sites: ['a.com', 'b.org', 'c.in', 'd.net'] })).toBe('Found 6 results · a.com, b.org, c.in');
    expect(statusText({ step: 'searched', count: 0, sites: [] })).toBe('No useful results; answering without them');
  });
});
