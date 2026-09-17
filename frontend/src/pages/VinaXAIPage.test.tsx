// @vitest-environment jsdom
/**
 * The chat surface end to end in a DOM, with the network mocked: the empty
 * state, a streamed reply with agent steps, the single model menu wired to
 * what goes on the wire, Agent mode, the settings dialog and delete-with-undo.
 * Deterministic — every request is answered by a canned body.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/audio/engine', () => ({
  audioEngine: { load: vi.fn(), preloadNext: vi.fn(), pause: vi.fn(), play: vi.fn(), seek: vi.fn() },
  orderedSources: () => [],
}));
vi.mock('@/services/media-session', () => ({
  setMediaHandlers: vi.fn(), updateMediaMetadata: vi.fn(), updatePlaybackState: vi.fn(), updatePositionState: vi.fn(),
}));
vi.mock('@/services/native', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/native')>()),
  checkNotificationOnFirstPlay: vi.fn(),
  haptic: vi.fn(),
  isNativePlatform: () => false,
}));
vi.mock('@/services/personalization/updater', () => ({
  recordComplete: vi.fn(), recordPlay: vi.fn(), recordQueueAdd: vi.fn(), recordSkip: vi.fn(), recordFavorite: vi.fn(),
}));
vi.mock('@/features/home/useAppConfig', () => ({ useClientConfig: () => null }));
vi.mock('@/hooks/usePageMeta', () => ({ usePageMeta: () => undefined }));

import { resetModelCatalogCache } from '@/features/ai/chat/useModelCatalog';
import VinaXAIPage from './VinaXAIPage';

const CATALOG = {
  groups: [
    {
      id: 'grq',
      label: 'VinaX GRQ ALL',
      hint: 'Instant answers',
      configured: true,
      models: [
        { id: 'vendor/agentic', label: 'agentic', provider: 'grq', context: 131072, agent: true },
        { id: 'vendor/plain-8b', label: 'plain-8b', provider: 'grq', context: 8192, agent: false },
      ],
    },
    { id: 'opr', label: 'VinaX OPR ALL', hint: 'Marketplace', configured: true, models: [{ id: 'lab/big:free', label: 'big', provider: 'opr', context: 1000000, agent: false }] },
  ],
};
const SSE =
  'data: {"meta":{"model":"vendor/agentic","sources":[]}}\n\n' +
  'data: {"step":{"tool":"search","label":"Searched the web for “songs”"}}\n\n' +
  'data: {"step":{"tool":"code","label":"Ran code"}}\n\n' +
  'data: {"delta":"Here is a **short** answer."}\n\n' +
  'data: {"delta":"\\n>>> Show an example | Why?"}\n\n' +
  'data: {"done":true}\n\n';

let posted: Array<Record<string, unknown>> = [];
let catalogCalls = 0;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('vinax.user-name', JSON.stringify('Tester Person'));
  posted = [];
  catalogCalls = 0;
  resetModelCatalogCache();
  window.matchMedia = ((q: string) => ({
    matches: q.includes('pointer: fine') || q.includes('min-width'),
    media: q,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith('/api/vinaxai')) {
        posted.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
        return Promise.resolve(new Response(SSE, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
      }
      if (url.endsWith('/api/aimodels')) {
        catalogCalls += 1;
        return Promise.resolve(new Response(JSON.stringify(CATALOG), { status: 200 }));
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const mount = () => render(<MemoryRouter><VinaXAIPage /></MemoryRouter>);
const box = (): HTMLTextAreaElement => screen.getByRole('textbox', { name: 'Message VinaX AI' }) as HTMLTextAreaElement;
const sendText = async (text: string): Promise<void> => {
  fireEvent.change(box(), { target: { value: text } });
  await act(async () => {
    fireEvent.keyDown(box(), { key: 'Enter' });
  });
};

describe('VinaX AI chat', () => {
  it('greets by first name, centres the composer, and offers suggestions — without fetching the catalogue', async () => {
    mount();
    expect(screen.getByRole('heading', { name: /^Good / }).textContent).toMatch(/^Good (morning|afternoon|evening), Tester$/);
    expect(box()).toBeTruthy();
    await waitFor(() => expect(within(screen.getByRole('group', { name: 'Suggestions' })).getAllByRole('button')).toHaveLength(4));
    expect(document.body.textContent).toMatch(/today for you/i);
    expect(screen.getByRole('button', { name: 'Saved prompts' })).toBeTruthy();
    expect(catalogCalls).toBe(0);
  });

  it('streams a reply: plain text, follow-ups, reply actions, and the agent activity folded to one line', async () => {
    mount();
    await sendText('Give me two songs');
    await waitFor(() => expect(document.body.textContent).toContain('short'));
    await waitFor(() => expect(screen.queryByRole('status', { name: 'Thinking' })).toBeNull());
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ mode: 'muse', web: false });
    expect(document.body.textContent).not.toContain('>>>');
    expect(screen.getByRole('button', { name: 'Show an example' })).toBeTruthy();
    const actions = screen.getByRole('group', { name: 'Reply actions' });
    for (const name of ['Copy', 'Regenerate', 'Good response', 'Bad response', 'Branch', 'Pin', 'More actions']) {
      expect(within(actions).getByRole('button', { name })).toBeTruthy();
    }
    const summary = screen.getByRole('button', { name: /Searched the web · ran code · 2 steps/ });
    expect(summary.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(summary);
    expect(within(screen.getByRole('list', { name: 'Agent activity' })).getAllByRole('listitem')).toHaveLength(2);
    // The composer is the same element, now docked under the thread.
    expect(box().value).toBe('');
  });

  it('one model menu: opening it fetches the catalogue once, and a catalogue pick goes on the wire as mode + model', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Model: Balanced' }));
    const list = await screen.findByRole('listbox', { name: 'Choose model' });
    await waitFor(() => expect(within(list).getByText('plain-8b')).toBeTruthy());
    expect(catalogCalls).toBe(1);
    fireEvent.click(within(list).getByText('big'));
    expect(screen.queryByRole('listbox', { name: 'Choose model' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Model: big' })).toBeTruthy();
    // Reopening inside five minutes costs nothing, and the pick is now a recent.
    fireEvent.click(screen.getByRole('button', { name: 'Model: big' }));
    expect(await screen.findByText('Recently used')).toBeTruthy();
    expect(catalogCalls).toBe(1);
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Search models' }), { key: 'Escape' });
    await sendText('hello');
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({ mode: 'router', model: 'lab/big:free' });
    expect(JSON.parse(localStorage.getItem('vinax.aiCatalogModels') ?? '{}')).toEqual({ opr: 'lab/big:free' });
    expect(JSON.parse(localStorage.getItem('vinax.aiLastModel') ?? '{}')).toEqual({ mode: 'router', model: 'lab/big:free' });
  });

  it('Agent mode switches to the best agent model, filters the menu, and restores the old model when switched off', async () => {
    mount();
    const agent = screen.getByRole('button', { name: 'Agent mode' });
    expect(agent.getAttribute('aria-pressed')).toBe('false');
    await act(async () => {
      fireEvent.click(agent);
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Agent mode' }).getAttribute('aria-pressed')).toBe('true'));
    expect(screen.getByRole('button', { name: 'Model: agentic' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Model: agentic' }));
    const options = within(await screen.findByRole('listbox', { name: 'Choose agent model' })).getAllByRole('option');
    expect(options.every((o) => o.textContent?.includes('Agent'))).toBe(true);
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Search models' }), { key: 'Escape' });
    await sendText('find todays news');
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({ mode: 'scholar', model: 'vendor/agentic' });
    fireEvent.click(screen.getByRole('button', { name: 'Agent mode' }));
    expect(screen.getByRole('button', { name: 'Model: Balanced' })).toBeTruthy();
  });

  it('disables the Agent toggle, with the reason, when no agent model is being served', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ groups: [CATALOG.groups[1]] }), { status: 200 }))));
    mount();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Agent mode' }));
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Agent mode' }).getAttribute('aria-disabled')).toBe('true'));
    const btn = screen.getByRole('button', { name: 'Agent mode' });
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(btn.getAttribute('title')).toBe('No agent model is available right now');
  });

  it('settings is a modal dialog with real tabs, arrow-key navigation, and every old setting on its old key', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Chat settings' }));
    const dialog = await screen.findByRole('dialog', { name: 'Chat settings' });
    const tabs = within(dialog).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['General', 'Replies', 'Voice', 'Data', 'Shortcuts']);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(within(dialog).getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(tabs[0].id);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Large' }));
    expect(localStorage.getItem('vinax.aiFontSize')).toBe('l');
    fireEvent.click(within(dialog).getByRole('switch', { name: 'Send with Enter' }));
    expect(localStorage.getItem('vinax.aiSendOnEnter')).toBe('0');

    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });
    expect(within(dialog).getByRole('tab', { name: 'Replies' }).getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(within(dialog).getByRole('tab', { name: 'Replies' }));
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Reply language' }), { target: { value: 'telugu' } });
    expect(localStorage.getItem('vinax.aiReplyLang')).toBe('telugu');
    fireEvent.change(within(dialog).getByRole('textbox', { name: /about you/i }), { target: { value: 'I like short answers' } });
    expect(localStorage.getItem('vinax.aiProfile')).toBe('I like short answers');
    expect(within(dialog).getByText('Use the song playing now')).toBeTruthy();

    fireEvent.keyDown(within(dialog).getByRole('tab', { name: 'Replies' }), { key: 'End' });
    expect(within(dialog).getByRole('tab', { name: 'Shortcuts' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(within(dialog).getByRole('tab', { name: 'Shortcuts' }), { key: 'ArrowLeft' });
    expect(within(dialog).getByRole('button', { name: /export all chats/i })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: /import chats/i })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close settings' }));
    expect(screen.queryByRole('dialog', { name: 'Chat settings' })).toBeNull();

    // Send-on-Enter is off now: Enter no longer sends, Ctrl+Enter does.
    await sendText('not sent');
    expect(posted).toHaveLength(0);
    await act(async () => {
      fireEvent.keyDown(box(), { key: 'Enter', ctrlKey: true });
    });
    await waitFor(() => expect(posted).toHaveLength(1));
    expect((posted[0].messages as Array<{ content: string }>)[0].content).toMatch(/reply in telugu/i);
    expect(posted[0].profile).toBe('I like short answers');
  });

  it('deletes a chat with Undo, and clears all chats with confirm + Undo', async () => {
    mount();
    await sendText('Remember this chat');
    await waitFor(() => expect(screen.queryByRole('status', { name: 'Thinking' })).toBeNull());
    const history = screen.getByRole('navigation', { name: 'Chat history' });
    expect(within(history).getByText('Remember this chat')).toBeTruthy();
    expect(within(history).getByRole('heading', { name: 'Today' })).toBeTruthy();
    fireEvent.click(within(history).getByRole('button', { name: 'Delete chat' }));
    expect(within(history).queryByText('Remember this chat')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(within(history).getByText('Remember this chat')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Chat settings' }));
    const dialog = await screen.findByRole('dialog', { name: 'Chat settings' });
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Data' }));
    fireEvent.click(within(dialog).getByRole('button', { name: /clear all chats/i }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete all' }));
    expect(within(history).queryByText('Remember this chat')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(within(history).getByText('Remember this chat')).toBeTruthy();
  });
});
