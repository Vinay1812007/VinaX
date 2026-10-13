// @vitest-environment jsdom
/**
 * 11.9 — "Trending now" on the empty chat: the answer is validated, the two
 * topics alternate, a tap asks VinaX AI about the story (a question the chat
 * searches the web for), and the strip is hidden when there is nothing.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TrendingNow } from './EmptyState';
import { headlinePrompt, loadHeadlines, readHeadlines, resetHeadlines } from './headlines';

const ANSWER = {
  updatedAt: '2026-10-13T06:23:00.000Z',
  topics: [
    { id: 'india', label: 'India', items: [{ title: 'India story one', url: 'https://news.example.in/1', site: 'news.example.in' }, { title: 'India story two', url: 'https://other.example.com/2', site: 'other.example.com' }] },
    { id: 'tech', label: 'Tech', items: [{ title: 'Tech story', url: 'https://tech.example.com/t', site: 'tech.example.com' }, { title: 'bad', url: 'javascript:alert(1)', site: 'x' }] },
    { id: 'gossip', label: 'Gossip', items: [{ title: 'never shown', url: 'https://g.example/', site: 'g.example' }] },
  ],
};

beforeEach(() => resetHeadlines());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('readHeadlines', () => {
  it('keeps valid headlines from known topics, alternating them, at most 8', () => {
    expect(readHeadlines(ANSWER).map((h) => [h.topic, h.title])).toEqual([
      ['India', 'India story one'],
      ['Tech', 'Tech story'],
      ['India', 'India story two'],
    ]);
    for (const junk of [null, 'x', { topics: 'no' }, { topics: [null, 1] }]) expect(readHeadlines(junk)).toEqual([]);
  });

  it('asks about the story, with a cue the chat searches the web for', () => {
    expect(headlinePrompt({ title: 'India story one' })).toBe('What\'s the latest news on this: "India story one"?');
  });
});

describe('loadHeadlines', () => {
  it('fetches once per ten minutes and never throws', async () => {
    const f = vi.fn(() => Promise.resolve(new Response(JSON.stringify(ANSWER), { status: 200 })));
    vi.stubGlobal('fetch', f);
    expect(await loadHeadlines()).toHaveLength(3);
    expect(await loadHeadlines()).toHaveLength(3);
    expect(f).toHaveBeenCalledTimes(1);
    resetHeadlines();
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    expect(await loadHeadlines()).toEqual([]);
  });
});

describe('TrendingNow', () => {
  it('shows the headlines with their topic and site, and a tap sends the question', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify(ANSWER), { status: 200 }))));
    const onSend = vi.fn();
    const { container } = render(<TrendingNow onSend={onSend} />);
    const card = await screen.findByText('India story one');
    expect(screen.getByRole('region', { name: 'Trending now' })).toBeTruthy();
    expect(container.querySelectorAll('.ai-trending-card')).toHaveLength(3);
    expect(container.textContent).toContain('Tech');
    expect([...container.querySelectorAll('img')].every((i) => i.getAttribute('src')?.startsWith('/api/favicon?host='))).toBe(true);
    fireEvent.click(card);
    expect(onSend).toHaveBeenCalledWith('What\'s the latest news on this: "India story one"?');
  });

  it('is not shown when there are no headlines', async () => {
    const f = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ topics: [] }), { status: 200 })));
    vi.stubGlobal('fetch', f);
    const { container } = render(<TrendingNow onSend={() => undefined} />);
    await vi.waitFor(() => expect(f).toHaveBeenCalled());
    await Promise.resolve();
    expect(container.querySelector('.ai-trending')).toBeNull();
  });
});
