// @vitest-environment jsdom
/**
 * The chat surface end to end in a DOM, with the network mocked: the empty
 * state, a streamed reply, the single model menu wired to what goes on the
 * wire, the settings dialog and delete-with-undo.
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

// 10.3 — GET /api/aimodels: always the four providers, in menu order.
const CATALOG = {
  fetchedAt: '2026-10-06T00:00:00.000Z',
  providers: [
    {
      id: 'nvidia',
      label: 'NVIDIA',
      configured: true,
      models: [
        { id: 'lab/alpha-70b', name: 'Alpha 70B', maker: 'Lab One', context: 131072, vision: false },
        { id: 'lab/alpha-11b-vision', name: 'Alpha 11B Vision', maker: 'Lab One', context: 8192, vision: true },
      ],
    },
    { id: 'openrouter', label: 'OpenRouter', configured: true, models: [{ id: 'maker/big:free', name: 'Big Model', maker: 'Maker Two', context: 1000000, vision: false }] },
    { id: 'groq', label: 'Groq', configured: true, models: [{ id: 'small-8b', name: 'Small 8B', maker: null, context: 8192, vision: false }] },
    { id: 'gemini', label: 'Gemini', configured: false, models: [] },
  ],
};
// 10.2 — an older server may still send sources and step frames: the chat
// must ignore them (no timeline, no source list).
const SSE =
  'data: {"meta":{"model":"Alpha 70B","modelId":"lab/alpha-70b","provider":"nvidia","mode":"auto","sources":["https://a.example/x"]}}\n\n' +
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

  it('streams a reply: plain text, follow-ups and reply actions, with nothing from retired stream fields', async () => {
    mount();
    await sendText('Give me two songs');
    await waitFor(() => expect(document.body.textContent).toContain('short'));
    await waitFor(() => expect(screen.queryByRole('status', { name: 'Thinking' })).toBeNull());
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ mode: 'auto' });
    expect(posted[0]).not.toHaveProperty('provider');
    expect(posted[0]).not.toHaveProperty('web');
    // 10.3 — who answered: the provider's logo and the model's original name from meta.
    const chip = document.querySelector('.ai-engine-chip');
    expect(chip?.textContent).toBe('Alpha 70B');
    expect(chip?.querySelector('svg')?.getAttribute('data-provider')).toBe('nvidia');
    expect(document.body.textContent).not.toContain('>>>');
    expect(screen.getByRole('button', { name: 'Show an example' })).toBeTruthy();
    const actions = screen.getByRole('group', { name: 'Reply actions' });
    for (const name of ['Copy', 'Regenerate', 'Good response', 'Bad response', 'Branch', 'Pin', 'More actions']) {
      expect(within(actions).getByRole('button', { name })).toBeTruthy();
    }
    expect(screen.queryByRole('list', { name: 'Tool activity' })).toBeNull();
    expect(document.body.textContent).not.toContain('Ran code');
    expect(document.body.textContent).not.toContain('a.example');
    // The composer is the same element, now docked under the thread.
    expect(box().value).toBe('');
  });

  it('one model menu: opening it fetches the list once, and a pick goes on the wire as mode + provider + model', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Model: Auto' }));
    const list = await screen.findByRole('listbox', { name: 'Choose model' });
    await waitFor(() => expect(within(list).getByText('Small 8B')).toBeTruthy());
    expect(catalogCalls).toBe(1);
    expect(within(list).getByRole('group', { name: 'Gemini' }).textContent).toContain('Not available right now');
    fireEvent.click(within(list).getByText('Big Model'));
    expect(screen.queryByRole('listbox', { name: 'Choose model' })).toBeNull();
    // The trigger: the provider's logo and the model's original name.
    const trigger = screen.getByRole('button', { name: 'Model: Big Model' });
    expect(trigger.querySelector('svg[data-provider]')?.getAttribute('data-provider')).toBe('openrouter');
    // Reopening inside five minutes costs nothing, and the pick is now a recent.
    fireEvent.click(trigger);
    expect(await screen.findByText('Recently used')).toBeTruthy();
    expect(catalogCalls).toBe(1);
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Search models' }), { key: 'Escape' });
    await sendText('hello');
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({ mode: 'model', provider: 'openrouter', model: 'maker/big:free' });
    expect(JSON.parse(localStorage.getItem('vinax.aiLastModel') ?? '{}')).toEqual({ mode: 'model', provider: 'openrouter', model: 'maker/big:free', name: 'Big Model' });

    // Back to Auto: the wire says so, with no provider or model.
    fireEvent.click(screen.getByRole('button', { name: 'Model: Big Model' }));
    fireEvent.click(within(await screen.findByRole('listbox', { name: 'Choose model' })).getByText('Auto'));
    expect(screen.getByRole('button', { name: 'Model: Auto' }).querySelector('svg[data-provider]')).toBeNull();
    await sendText('and again');
    await waitFor(() => expect(posted).toHaveLength(2));
    expect(posted[1].mode).toBe('auto');
    expect(posted[1]).not.toHaveProperty('provider');
    expect(posted[1]).not.toHaveProperty('model');
  });

  it('a pick stored by an older build (a seat, or a catalogue pick) starts the visit on Auto, quietly', async () => {
    localStorage.setItem('vinax.aiLastModel', JSON.stringify({ mode: 'router', model: 'lab/big:free' }));
    localStorage.setItem('vinax.aiDefaultMode', 'maestro');
    localStorage.setItem('vinax.aiCatalogModels', JSON.stringify({ opr: 'lab/big:free' }));
    localStorage.setItem('vinax.aiRecentModels', JSON.stringify([{ mode: 'sage' }, { mode: 'scholar', model: 'vendor/agentic' }]));
    mount();
    expect(screen.getByRole('button', { name: 'Model: Auto' })).toBeTruthy();
    await waitFor(() => expect(localStorage.getItem('vinax.aiCatalogModels')).toBeNull());
    expect(localStorage.getItem('vinax.aiLastModel')).toBeNull();
    expect(localStorage.getItem('vinax.aiDefaultMode')).toBeNull();
    expect(JSON.parse(localStorage.getItem('vinax.aiRecentModels') ?? 'null')).toEqual([]);
    await sendText('hi');
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].mode).toBe('auto');
    expect(catalogCalls).toBe(0);
  });

  it('has no Agent mode, and clears a stale "Start in Agent mode" left by an older build', async () => {
    localStorage.setItem('vinax.aiAgentStart', '1');
    mount();
    expect(screen.queryByRole('button', { name: 'Agent mode' })).toBeNull();
    await waitFor(() => expect(localStorage.getItem('vinax.aiAgentStart')).toBeNull());
    expect(catalogCalls).toBe(0);
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
