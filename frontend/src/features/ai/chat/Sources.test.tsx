// @vitest-environment jsdom
/** 11.0 / 11.2 — what a web-grounded reply drew on: the searching status, the
 *  inline source chips, the Sources panel, the sealed suggestion snippet, and
 *  the web search tool in the model list. */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CITE_MARK } from '@/components/ai/cite';
import { placeCitations, siteName, sourceLabel } from './citations';
import { AssistantMessage, searchedWeb, type MessageHandlers } from './Message';
import { canSearchWeb, parseCatalogResponse, parseFeatures, WEB_TOOL } from './models';
import { SourceChip } from './Sources';
import { readSources } from './streamReducer';
import type { Msg, MsgSources } from './types';

afterEach(cleanup);

const handlers = (): MessageHandlers => ({
  edit: vi.fn(),
  rate: vi.fn(),
  togglePin: vi.fn(),
  branch: vi.fn(),
  regenerate: vi.fn(),
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

// The search service names a page by its domain and links it through a redirect.
const ITEMS = [
  { url: 'https://redirect.example/r/1', title: 'citytoday.example' },
  { url: 'https://redirect.example/r/2', title: 'dailyherald.co.in' },
  { url: 'https://news.example.net/story', title: 'Rain expected all week' },
];
const marks = (t: string): number => Array.from(t.matchAll(CITE_MARK)).length;

describe('naming a source', () => {
  it('uses the domain label, capitalised, when the title is just a domain; a real title stays the title', () => {
    expect(siteName('citytoday.example')).toBe('Citytoday');
    expect(siteName('www.dailyherald.co.in')).toBe('Dailyherald');
    expect(siteName('news.example.org')).toBe('Example');
    expect(sourceLabel(ITEMS[0])).toEqual({ name: 'Citytoday', host: 'citytoday.example', pageTitle: '', letter: 'C' });
    expect(sourceLabel(ITEMS[2])).toEqual({ name: 'Rain expected all week', host: 'news.example.net', pageTitle: 'Rain expected all week', letter: 'R' });
    expect(sourceLabel({ url: 'https://www.example.org/a', title: '' })).toMatchObject({ name: 'Example', host: 'example.org', letter: 'E' });
  });
});

describe('placing source chips', () => {
  it('puts one mark at the end of each supported sentence or list item, and merges marks on the same spot', () => {
    const text = 'It will rain today. Highs of 31 degrees are likely.\n\n- **Wind**: light, from the west\n- Humidity is high';
    const out = placeCitations(
      text,
      [
        { text: 'It will rain today.', sources: [0] },
        { text: 'Highs of 31 degrees', sources: [1] },
        { text: 'are likely.', sources: [0] },
        { text: '**Wind**: light', sources: [2] },
        { text: 'not in the reply', sources: [0] },
        { text: 'Humidity is high', sources: [7] },
      ],
      3,
    );
    expect(out.cites).toEqual([[0], [1, 0], [2]]);
    const plain = out.text.replace(CITE_MARK, (_m, n: string) => `[${n}]`);
    expect(plain).toBe('It will rain today.[0] Highs of 31 degrees are likely.[1]\n\n- **Wind**: light, from the west[2]\n- Humidity is high');
  });

  it('never marks code, tables, inline code, maths or links, and leaves a reply without supports alone', () => {
    const text = ['```js', 'const rain = true;', '```', '| City | Rain |', '|---|---|', '| A | yes |', 'Use `rain. flag` here', 'See [the forecast](https://x.example/f) now.'].join('\n');
    const out = placeCitations(
      text,
      [
        { text: 'const rain = true;', sources: [0] },
        { text: '| A | yes', sources: [0] },
        { text: 'Use `rain', sources: [0] },
        { text: 'See [the fore', sources: [0] },
      ],
      1,
    );
    // The last one moves to the end of its sentence, past the link: allowed.
    expect(out.cites).toEqual([[0]]);
    expect(out.text.endsWith('now.0')).toBe(true);
    expect(placeCitations('Plain.', undefined, 3)).toEqual({ text: 'Plain.', cites: [] });
  });
});

describe('readSources (11.2 supports)', () => {
  it('remaps indexes onto the items it keeps and drops the ones that point at nothing', () => {
    const s = readSources({
      items: [{ url: 'javascript:alert(1)' }, { url: 'https://a.example', title: 'a.example' }, { url: 'https://a.example' }, { url: 'https://b.example' }],
      queries: [],
      entry: null,
      supports: [{ text: 'One.', sources: [1, 2] }, { text: 'Two.', sources: [3, 0] }, { text: 'Three.', sources: [9] }, { text: '', sources: [1] }, 'junk'],
    })!;
    expect(s.items.map((i) => i.url)).toEqual(['https://a.example', 'https://b.example']);
    expect(s.supports).toEqual([
      { text: 'One.', sources: [0] },
      { text: 'Two.', sources: [1] },
    ]);
    expect(readSources({ items: [{ url: 'https://a.example' }] })).not.toHaveProperty('supports');
  });
});

describe('a web-grounded reply', () => {
  const sources: MsgSources = {
    items: ITEMS,
    queries: ['rain forecast this week'],
    entry: '<div>chips</div>',
    supports: [
      { text: 'It will rain today.', sources: [0] },
      { text: 'Highs of 31 degrees.', sources: [1, 2] },
    ],
  };
  const m: Msg = { role: 'assistant', content: 'It will rain today. Highs of 31 degrees.', engine: 'Model', tools: [WEB_TOOL], sources };

  it('says "Searching the web" with a globe before the first word, only when search is on', () => {
    reply({ role: 'assistant', content: '', tools: [WEB_TOOL] }, true);
    expect(screen.getByRole('status', { name: 'Searching the web' }).textContent).toContain('Searching the web');
    cleanup();
    reply({ role: 'assistant', content: '' }, true);
    expect(screen.getByRole('status', { name: 'Thinking' })).toBeTruthy();
    expect(screen.queryByText('Searching the web')).toBeNull();
  });

  it('draws a chip at the end of each supported sentence that opens the page safely', () => {
    const { container } = reply(m);
    const chips = container.querySelectorAll<HTMLAnchorElement>('a.ai-cite');
    expect(chips).toHaveLength(2);
    expect(chips[0].textContent).toBe('CCitytoday');
    expect(chips[0].getAttribute('aria-label')).toBe('Source: Citytoday');
    expect(chips[0].getAttribute('href')).toBe(ITEMS[0].url);
    expect(chips[0].getAttribute('title')).toBe('citytoday.example');
    expect(chips[1].textContent).toBe('DDailyherald+1');
    expect(chips[1].getAttribute('aria-label')).toBe('Source: Dailyherald and 1 more');
    for (const a of chips) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    }
    // The chip sits inside the sentence's paragraph, and no mark leaks as text.
    expect(chips[0].closest('p')?.textContent).toContain('It will rain today.');
    expect(marks(container.textContent ?? '')).toBe(0);
    expect(document.querySelector('img')).toBeNull();
    // The suggestion snippet stays on show, sealed.
    const frame = screen.getByTitle('Search suggestions') as HTMLIFrameElement;
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('srcdoc')).toBe('<div>chips</div>');
  });

  it('opens the Sources panel from the action row; Escape closes it and gives focus back', () => {
    reply(m);
    const btn = screen.getByRole('button', { name: /Sources/ });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(btn);
    const panel = screen.getByRole('region', { name: 'Sources' });
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(btn.getAttribute('aria-controls')).toBe(panel.id);
    expect(document.activeElement).toBe(panel);
    const rows = within(panel).getAllByRole('link');
    expect(rows.map((r) => r.textContent)).toEqual(['1CCitytodaycitytoday.example', '2DDailyheralddailyherald.co.in', '3RRain expected all weeknews.example.net']);
    expect(within(panel).getByText(/Searched for: “rain forecast this week”/)).toBeTruthy();
    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Sources' })).toBeNull();
    expect(document.activeElement).toBe(btn);
    fireEvent.click(btn);
    fireEvent.click(screen.getByRole('button', { name: 'Close sources' }));
    expect(screen.queryByRole('region', { name: 'Sources' })).toBeNull();
    expect(document.activeElement).toBe(btn);
  });

  it('a reply stored before 11.2 (no supports) still gets the Sources button, without chips', () => {
    const { container } = reply({ ...m, sources: { ...sources, supports: undefined } });
    expect(container.querySelector('a.ai-cite')).toBeNull();
    expect(screen.getByRole('button', { name: /Sources/ })).toBeTruthy();
  });

  it('a chip with no known page draws nothing', () => {
    const { container } = render(<SourceChip items={ITEMS} sources={[9]} />);
    expect(container.innerHTML).toBe('');
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
