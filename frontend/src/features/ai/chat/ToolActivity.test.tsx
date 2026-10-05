// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ToolActivity } from './ToolActivity';
import type { AgentStep } from './types';

afterEach(cleanup);

const STEPS: AgentStep[] = [
  { tool: 'search', label: 'Searched the web for “news”' },
  { tool: 'code', label: 'Ran code' },
];

const head = (name?: RegExp): HTMLElement => (name ? screen.getByRole('button', { name }) : screen.getByRole('button'));
const body = (): HTMLElement => document.getElementById(head().getAttribute('aria-controls') ?? '')!;
const rows = (): HTMLElement[] => within(screen.getByRole('list', { name: 'Tool activity', hidden: true })).getAllByRole('listitem', { hidden: true });

describe('ToolActivity', () => {
  it('renders nothing when the stream reported no tools and no search', () => {
    const { container } = render(<ToolActivity working={false} answering />);
    expect(container.firstChild).toBeNull();
  });

  it('is open while the reply is worked on, naming the step in progress, with a spinner on that row only', () => {
    render(<ToolActivity steps={STEPS} working answering={false} />);
    expect(head().getAttribute('aria-expanded')).toBe('true');
    expect(head().textContent).toContain('Running code…');
    expect(body().getAttribute('data-open')).toBe('true');
    expect(body().hasAttribute('inert')).toBe(false);
    expect(rows().map((r) => r.getAttribute('data-status'))).toEqual(['done', 'running']);
    expect(rows()[1].textContent).toContain('In progress');
    expect(rows()[1].querySelector('.ai-spinner')).not.toBeNull();
    expect(rows()[0].textContent).toContain('Done');
    expect(rows()[0].querySelector('.ai-spinner')).toBeNull();
  });

  it('folds as soon as the answer starts to arrive, while the reply is still streaming', () => {
    const { rerender } = render(<ToolActivity steps={STEPS} working answering={false} />);
    expect(head().getAttribute('aria-expanded')).toBe('true');
    rerender(<ToolActivity steps={STEPS} working answering />);
    expect(head(/Used 2 tools/).getAttribute('aria-expanded')).toBe('false');
    expect(body().hasAttribute('inert')).toBe(true);
  });

  it('folds to one line when the answer finishes, and opens again on demand', () => {
    const { rerender } = render(<ToolActivity steps={STEPS} working answering={false} />);
    rerender(<ToolActivity steps={STEPS} working={false} answering />);
    const h = head(/Used 2 tools/);
    expect(h.getAttribute('aria-expanded')).toBe('false');
    // Folded: still in the DOM for the height animation, but inert.
    expect(body().getAttribute('data-open')).toBe('false');
    expect(body().hasAttribute('inert')).toBe(true);
    fireEvent.click(h);
    expect(h.getAttribute('aria-expanded')).toBe('true');
    expect(body().getAttribute('data-open')).toBe('true');
    expect(body().hasAttribute('inert')).toBe(false);
    fireEvent.click(h);
    expect(h.getAttribute('aria-expanded')).toBe('false');
    expect(body().hasAttribute('inert')).toBe(true);
  });

  it('shows a web search as "Searched the web · N sources" with the hosts it returned', () => {
    const sources = ['https://a.example/1', 'https://b.example/2', 'https://c.example', 'https://d.example', 'https://e.example'];
    render(<ToolActivity sources={sources} working={false} answering />);
    expect(head(/Searched the web · 5 sources/)).toBeTruthy();
    const [row] = rows();
    expect(row.textContent).toContain('a.example');
    expect(row.textContent).toContain('d.example');
    expect(row.textContent).not.toContain('e.example');
    expect(row.textContent).toContain('+1');
  });
});
