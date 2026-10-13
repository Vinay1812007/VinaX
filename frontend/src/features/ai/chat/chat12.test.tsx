// @vitest-environment jsdom
/**
 * 12.0 — the reasoning block, pictures, site logos, deep-research steps, the
 * title frame and the Deep research switch.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectorViews } from '@/features/ai/connectors';
import { AssistantMessage, type MessageHandlers } from './Message';
import { SiteMark } from './SiteMark';
import { initialStreamState, readSources, reduceFrame, THINK_MAX } from './streamReducer';
import type { Msg } from './types';

afterEach(cleanup);

const handlers = (): MessageHandlers => ({
  edit: vi.fn(),
  rate: vi.fn(),
  togglePin: vi.fn(),
  branch: vi.fn(),
  regenerate: vi.fn(),
  askWith: vi.fn(),
  switchVersion: vi.fn(),
  reviseLast: vi.fn(),
  continueReply: vi.fn(),
  rewrite: vi.fn(),
  send: vi.fn(),
});
const reply = (m: Msg, streaming = false) =>
  render(
    <MemoryRouter>
      <AssistantMessage m={m} index={1} last streaming={streaming} busy={streaming} speaking={false} speakKey="k" handlers={handlers()} />
    </MemoryRouter>,
  );
const run = (frames: unknown[]) => frames.reduce((s: ReturnType<typeof initialStreamState>, f) => reduceFrame(s, f), initialStreamState());
const IMG = `/api/webimg?u=${encodeURIComponent('https://img.example/a.jpg')}&s=${'a'.repeat(32)}`;

describe('stream frames', () => {
  it('think frames gather the reasoning (capped); a title frame is kept once', () => {
    const s = run([{ think: 'Let me ' }, { think: 'see.' }, { title: '  BMW meaning   explained ' }, { title: 'Other' }, { delta: 'Answer.' }]);
    expect(s.thinking).toBe('Let me see.');
    expect(s.title).toBe('BMW meaning explained');
    expect(s.text).toBe('Answer.');
    expect(run([{ think: 'x'.repeat(THINK_MAX + 50) }]).thinking).toHaveLength(THINK_MAX);
  });

  it('research steps keep their queries; sources keep up to 12 items and only Worker picture links', () => {
    const s = run([{ status: { step: 'planning', query: 'BMW', research: true } }, { status: { step: 'searching', query: 'BMW', queries: ['BMW', 'BMW history'], research: true } }]);
    expect(s.activity).toEqual({ step: 'searching', query: 'BMW', queries: ['BMW', 'BMW history'], research: true });
    const items = Array.from({ length: 14 }, (_, i) => ({ url: `https://s${i}.example/`, title: `S${i}` }));
    const src = readSources({ items, queries: ['q'], entry: null, images: [{ src: IMG, page: 'https://a.example/', alt: 'A' }, { src: 'https://evil.example/x.jpg', page: '', alt: '' }, { src: '/api/webimg?u=x&s=short', page: '', alt: '' }] });
    expect(src?.items).toHaveLength(12);
    expect(src?.images).toEqual([{ src: IMG, page: 'https://a.example/', alt: 'A' }]);
  });
});

describe('the reply', () => {
  it('shows live reasoning while it thinks, then folds it away as "Thought for Ns"', () => {
    reply({ role: 'assistant', content: '', thinking: 'Working through the numbers.' }, true);
    expect(screen.getByRole('status', { name: 'Thinking' }).textContent).toContain('Working through the numbers.');
    cleanup();
    const { container } = reply({ role: 'assistant', content: 'The answer is 4.', thinking: 'Working through the numbers.', thoughtMs: 12_300 });
    const details = container.querySelector('details.ai-thought') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(details.querySelector('summary')?.textContent).toBe('Thought for 12s');
    expect(details.textContent).toContain('Working through the numbers.');
    expect(container.querySelector('.ai-reply')?.textContent).not.toContain('Working through');
  });

  it('shows the search pictures through the Worker, opening the page they came from', () => {
    const { container } = reply({
      role: 'assistant',
      content: 'BMW is a carmaker [1].',
      engine: 'Model',
      sources: { items: [{ url: 'https://a.example/', title: 'A' }], queries: ['bmw'], entry: null, images: [{ src: IMG, page: 'https://a.example/', alt: 'BMW logo' }] },
    });
    const img = container.querySelector('.ai-pictures img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(IMG);
    expect(img.getAttribute('alt')).toBe('BMW logo');
    expect(img.closest('a')?.getAttribute('href')).toBe('https://a.example/');
    fireEvent.error(img);
    expect(container.querySelector('.ai-pictures')).toBeNull();
  });

  it('deep research says what it is doing at each step', () => {
    reply({ role: 'assistant', content: '', activity: { step: 'planning', query: 'BMW', research: true } }, true);
    expect(screen.getByRole('status', { name: 'Planning the research' })).toBeTruthy();
    cleanup();
    reply({ role: 'assistant', content: '', activity: { step: 'searching', query: 'BMW', queries: ['BMW', 'BMW history', 'BMW sales'], research: true } }, true);
    const s = screen.getByRole('status', { name: 'Running 3 web searches' });
    expect(s.textContent).toContain('“BMW history”');
    cleanup();
    reply({ role: 'assistant', content: '', activity: { step: 'searched', query: 'BMW', queries: ['a b', 'c d', 'e f', 'g h'], count: 11, sites: ['a.example'], research: true } }, true);
    expect(screen.getByRole('status', { name: 'Reading 11 sources from 4 searches — writing the report' })).toBeTruthy();
  });
});

describe('site logos and the Deep research switch', () => {
  it('SiteMark loads the logo through the Worker and falls back to the letter', () => {
    const { container } = render(<SiteMark host="www.Example.com" letter="E" />);
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/api/favicon?host=example.com');
    fireEvent.error(img);
    expect(container.textContent).toBe('E');
    cleanup();
    expect(render(<SiteMark host="" letter="S" />).container.querySelector('img')).toBeNull();
  });

  it('Deep research is a connector row, off by default', () => {
    const views = connectorViews({ think: false, nowPlaying: false, memoryOn: false, memoryCount: 0 });
    expect(views.find((v) => v.id === 'research')).toMatchObject({ name: 'Deep research', on: false });
    expect(connectorViews({ think: false, research: true, nowPlaying: false, memoryOn: false, memoryCount: 0 }).find((v) => v.id === 'research')?.on).toBe(true);
  });
});
