// @vitest-environment jsdom
/** 11.0 — the Sources row under a web-grounded reply, and the web search tool in the model list. */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Sources, searchedWeb } from './Message';
import { canSearchWeb, parseCatalogResponse, parseFeatures, WEB_TOOL } from './models';

afterEach(cleanup);

describe('Sources', () => {
  it('shows up to eight pills that open in a new tab safely, the caption, and the snippet in a sealed frame', () => {
    const items = Array.from({ length: 9 }, (_, i) => ({ url: `https://site${i}.example/page`, title: i === 0 ? '' : `Title ${i}` }));
    render(<Sources s={{ items, queries: ['weather today'], entry: '<div>chips</div>' }} />);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(8);
    expect(links[0].textContent).toBe('site0.example');
    expect(links[1].textContent).toBe('Title 1');
    for (const a of links) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    }
    expect(screen.getByText('Searched the web')).toBeTruthy();
    const frame = screen.getByTitle('Search suggestions') as HTMLIFrameElement;
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('srcdoc')).toBe('<div>chips</div>');
    expect(document.querySelector('img')).toBeNull();
  });
  it('renders nothing without pages or a snippet, and no caption without queries', () => {
    const { container } = render(<Sources s={{ items: [], queries: ['q'], entry: null }} />);
    expect(container.innerHTML).toBe('');
    cleanup();
    render(<Sources s={{ items: [{ url: 'https://a.example', title: 'A' }], queries: [], entry: null }} />);
    expect(screen.queryByText('Searched the web')).toBeNull();
    expect(screen.queryByTitle('Search suggestions')).toBeNull();
  });
  it('searchedWeb reads the web_search tool from meta', () => {
    expect(searchedWeb({ tools: ['web_search'] })).toBe(true);
    expect(searchedWeb({ tools: ['code_execution'] })).toBe(false);
    expect(searchedWeb({})).toBe(false);
  });
});

describe('the web search tool in the model list', () => {
  const body = {
    providers: [
      {
        id: 'gemini',
        label: 'Gemini',
        configured: true,
        models: [
          { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', maker: 'Google', context: 1_000_000, vision: true },
          { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', maker: 'Google', context: 1_000_000, vision: true },
        ],
        tools: [
          { id: 'code_execution', name: 'Code execution', models: ['gemini-2.5-flash', 'gemini-3.8-flash'] },
          { id: 'web_search', name: 'Web search', models: ['gemini-2.5-flash'] },
        ],
      },
    ],
    features: { image: false, speech: false, transcription: false, music: false, code: true, web: true },
  };
  it('is kept per provider and read into features.web', () => {
    const providers = parseCatalogResponse(body);
    expect(providers.find((p) => p.id === 'gemini')?.tools?.map((t) => t.id)).toEqual(['code_execution', WEB_TOOL]);
    expect(canSearchWeb(providers, 'gemini', 'gemini-2.5-flash')).toBe(true);
    expect(canSearchWeb(providers, 'gemini', 'gemini-3.8-flash')).toBe(false);
    expect(parseFeatures(body).web).toBe(true);
    expect(parseFeatures({ features: { code: true } }).web).toBe(false);
  });
});
