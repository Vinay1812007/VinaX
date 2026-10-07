// @vitest-environment jsdom
/**
 * 10.3 — the chat's new model kinds and tools, in a DOM with the network
 * mocked: each one is gated on `features` from GET /api/aimodels; Create
 * image and Create music clip post their body and render the result with who
 * made it; Run code rides the request and marks the reply; Settings → Voice
 * lists every speech model's voices and the dictation models, and keeps an
 * older build's voice.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/audio/engine', () => ({
  audioEngine: { load: vi.fn(), preloadNext: vi.fn(), pause: vi.fn(), play: vi.fn(), seek: vi.fn(), setVolume: vi.fn() },
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
vi.mock('@/features/home/useAppConfig', () => ({ useClientConfig: () => null, useFeatureFlags: () => ({ codeRun: false }) }));
vi.mock('@/hooks/usePageMeta', () => ({ usePageMeta: () => undefined }));

import { resetModelCatalogCache } from '@/features/ai/chat/useModelCatalog';
import VinaXAIPage from './VinaXAIPage';

const BASE_PROVIDERS = [
  {
    id: 'nvidia',
    label: 'NVIDIA',
    configured: true,
    models: [
      { id: 'lab/alpha-70b', name: 'Alpha 70B', maker: 'Lab One', context: 131072, vision: false },
      { id: 'lab/beta-8b', name: 'Beta 8B', maker: 'Lab One', context: 8192, vision: false },
    ],
  },
  { id: 'openrouter', label: 'OpenRouter', configured: true, models: [] },
  { id: 'groq', label: 'Groq', configured: true, models: [{ id: 'small-8b', name: 'Small 8B', maker: null, context: 8192, vision: false }] },
  { id: 'gemini', label: 'Gemini', configured: true, models: [] },
];
/** A 10.3 server: media, tools and features. */
const FULL = {
  features: { image: true, speech: true, transcription: true, music: true, code: true },
  providers: BASE_PROVIDERS.map((p) =>
    p.id === 'nvidia'
      ? {
          ...p,
          media: [{ id: 'lab/pixel-1', name: 'Pixel One', maker: 'Lab One', kind: 'image' }],
          tools: [{ id: 'code_execution', name: 'Code execution', models: ['lab/alpha-70b'] }],
        }
      : p.id === 'groq'
        ? { ...p, media: [{ id: 'ears-1', name: 'Ears One', maker: 'Maker', kind: 'transcription' }] }
        : p.id === 'gemini'
          ? { ...p, media: [{ id: 'g/tune', name: 'Tune One', maker: null, kind: 'music' }] }
          : p,
  ),
};
/** An older server: no features, media or tools. */
const OLD = { providers: BASE_PROVIDERS };

const SSE_CODE =
  'data: {"meta":{"model":"Alpha 70B","modelId":"lab/alpha-70b","provider":"nvidia","mode":"auto","tools":["code_execution"]}}\n\n' +
  'data: {"delta":"Worked it out:\\n\\n```python\\nprint(6*7)\\n```\\n\\n```\\n42\\n```"}\n\n' +
  'data: {"done":true}\n\n';

let catalog: unknown = FULL;
let posted: Array<{ url: string; body: Record<string, unknown> }> = [];

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('vinax.user-name', JSON.stringify('Tester'));
  posted = [];
  catalog = FULL;
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
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      if (init?.method === 'POST') posted.push({ url, body });
      if (url.endsWith('/api/vinaxai')) return Promise.resolve(new Response(SSE_CODE, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
      if (url.endsWith('/api/aimodels')) return Promise.resolve(new Response(JSON.stringify(catalog), { status: 200 }));
      if (url.endsWith('/api/image'))
        return Promise.resolve(new Response(JSON.stringify({ image: 'data:image/png;base64,iVBORw0KGgo=', model: 'Pixel One', modelId: 'lab/pixel-1', provider: 'nvidia' })));
      if (url.endsWith('/api/music'))
        return Promise.resolve(new Response(JSON.stringify({ audio: 'data:audio/wav;base64,UklGRg==', mime: 'audio/wav', model: 'Tune One', modelId: 'g/tune', provider: 'gemini' })));
      if (url.endsWith('/api/voices'))
        return Promise.resolve(
          new Response(
            JSON.stringify({
              configured: true,
              providers: [
                { id: 'groq', label: 'Groq', models: [{ id: 'canopylabs/orpheus-v1-english', name: 'Orpheus English', voices: ['autumn', 'troy'] }] },
                { id: 'gemini', label: 'Gemini', models: [{ id: 'g/speech', name: 'Speech One', voices: ['Kore'] }] },
              ],
            }),
          ),
        );
      return Promise.resolve(new Response('{}', { status: 200 }));
    }),
  );
  URL.createObjectURL = vi.fn(() => 'blob:clip');
  URL.revokeObjectURL = vi.fn();
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
const openPlus = async (): Promise<HTMLElement> => {
  fireEvent.click(screen.getByRole('button', { name: 'Attach and tools' }));
  return screen.findByRole('dialog', { name: 'Attach and tools' });
};

describe('VinaX AI — media and tools (10.3)', () => {
  it('an older server: no Create entries and no Run code, nothing crashes', async () => {
    catalog = OLD;
    mount();
    const menu = await openPlus();
    // 11.0 — the Place row is gone (place follows the app-wide region setting); Memory is the stored connector that is always listed.
    await waitFor(() => expect(within(menu).getByRole('switch', { name: 'Memory' })).toBeTruthy());
    expect(within(menu).queryByRole('switch', { name: 'Place' })).toBeNull();
    // Give the list a moment to arrive; still nothing new.
    await act(async () => {
      await Promise.resolve();
    });
    expect(within(menu).queryByRole('button', { name: /Create image/ })).toBeNull();
    expect(within(menu).queryByRole('button', { name: /Create music clip/ })).toBeNull();
    expect(within(menu).queryByRole('switch', { name: 'Run code' })).toBeNull();
  });

  it('Create image: picks the first image model, posts the prompt, shows the picture with who made it', async () => {
    mount();
    const menu = await openPlus();
    fireEvent.click(await within(menu).findByRole('button', { name: /Create image/ }));
    const bar = screen.getByRole('group', { name: 'Create image' });
    const picker = within(bar).getByRole('button', { name: 'Image model: Pixel One' });
    expect(picker.querySelector('svg[data-provider="nvidia"]')).toBeTruthy();
    fireEvent.click(picker);
    const list = screen.getByRole('listbox', { name: 'Choose image model' });
    expect(within(list).getByRole('group', { name: 'NVIDIA' })).toBeTruthy();
    fireEvent.keyDown(list, { key: 'Escape' });
    expect(box().placeholder).toMatch(/describe the image/i);

    await sendText('a red kite over paddy fields');
    await waitFor(() => expect(document.querySelector('img.ai-media-img')).toBeTruthy());
    expect(posted.find((p) => p.url.endsWith('/api/image'))?.body).toEqual({ prompt: 'a red kite over paddy fields', provider: 'nvidia', model: 'lab/pixel-1' });
    expect(posted.some((p) => p.url.endsWith('/api/vinaxai'))).toBe(false);
    const fig = document.querySelector('figure.ai-media')!;
    expect(fig.textContent).toContain('Made with Pixel One · NVIDIA');
    const dl = within(fig as HTMLElement).getByRole('link', { name: /download/i });
    expect(dl.getAttribute('download')).toBe('vinax-a-red-kite-over-paddy-fields.png');

    // Saved chats never keep the picture: a placeholder line on reload.
    await act(async () => {
      window.dispatchEvent(new Event('pagehide'));
    });
    const stored = JSON.parse(localStorage.getItem('vinax_ai_chats_v1') ?? '[]') as Array<{ messages: Array<{ media?: { src: string; model: string } }> }>;
    const media = stored[0].messages.find((m) => m.media)?.media;
    expect(media).toMatchObject({ src: '', model: 'Pixel One' });
    cleanup();
    mount();
    await waitFor(() => expect(document.body.textContent).toContain('Pictures aren’t kept on this device'));
  });

  it('Create music clip: posts the prompt and shows a player that never autoplays', async () => {
    mount();
    const menu = await openPlus();
    fireEvent.click(await within(menu).findByRole('button', { name: /Create music clip/ }));
    expect(within(screen.getByRole('group', { name: 'Create music clip' })).getByRole('button', { name: 'Music model: Tune One' })).toBeTruthy();
    await sendText('a calm sitar loop');
    await waitFor(() => expect(document.querySelector('audio.ai-media-audio')).toBeTruthy());
    expect(posted.find((p) => p.url.endsWith('/api/music'))?.body).toEqual({ prompt: 'a calm sitar loop', provider: 'gemini', model: 'g/tune' });
    const audio = document.querySelector('audio.ai-media-audio') as HTMLAudioElement;
    expect(audio.autoplay).toBe(false);
    expect(audio.getAttribute('src')).toBe('blob:clip');
    expect(document.querySelector('figure.ai-media')?.textContent).toContain('Made with Tune One · Gemini');
  });

  it('Run code: listed when the server can, rides the request, and marks a reply that ran code', async () => {
    mount();
    const menu = await openPlus();
    const sw = await within(menu).findByRole('switch', { name: 'Run code' });
    fireEvent.click(sw);
    expect(localStorage.getItem('vinax.ai.codeOn')).toBe('1');
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.getByRole('group', { name: 'Active connectors' }).textContent).toContain('Run code');
    await sendText('what is six times seven');
    await waitFor(() => expect(document.querySelector('.ai-ran-code')).toBeTruthy());
    expect(posted.find((p) => p.url.endsWith('/api/vinaxai'))?.body).toMatchObject({ mode: 'auto', tools: ['code_execution'] });

    // A pinned model that cannot run code: the chip says so, and the tool is not asked for.
    fireEvent.click(screen.getByRole('button', { name: 'Model: Auto' }));
    const list = await screen.findByRole('listbox', { name: 'Choose model' });
    expect(within(within(list).getByText('Alpha 70B').closest('[role="option"]') as HTMLElement).getByText('Runs code')).toBeTruthy();
    fireEvent.click(within(list).getByText('Beta 8B'));
    expect(screen.getByRole('group', { name: 'Active connectors' }).textContent).toContain('not available with this model');
    await sendText('and again');
    await waitFor(() => expect(posted.filter((p) => p.url.endsWith('/api/vinaxai'))).toHaveLength(2));
    expect(posted.filter((p) => p.url.endsWith('/api/vinaxai'))[1].body).not.toHaveProperty('tools');
  });

  it('Settings → Voice: keeps an older voice, lists every provider’s voices, and the dictation models', async () => {
    localStorage.setItem('vinax.aiVoice', 'canopylabs/orpheus-v1-english|troy');
    mount();
    // Migrated on arrival, so the DJ voice and read aloud agree.
    expect(localStorage.getItem('vinax.aiVoice')).toBe('groq|canopylabs/orpheus-v1-english|troy');
    fireEvent.click(screen.getByRole('button', { name: 'Chat settings' }));
    const dialog = await screen.findByRole('dialog', { name: 'Chat settings' });
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Voice' }));
    const voices = within(dialog).getByRole('radiogroup', { name: 'Spoken reply voice' });
    await waitFor(() => expect(within(voices).getByRole('radio', { name: 'Troy · Orpheus English · Groq' })).toBeTruthy());
    expect(within(voices).getByRole('radio', { name: 'Troy · Orpheus English · Groq' }).getAttribute('aria-checked')).toBe('true');
    expect(within(voices).getByRole('group', { name: 'Gemini' })).toBeTruthy();
    fireEvent.click(within(voices).getByRole('radio', { name: 'Kore · Speech One · Gemini' }));
    expect(localStorage.getItem('vinax.aiVoice')).toBe('gemini|g/speech|Kore');
    fireEvent.click(within(voices).getByRole('radio', { name: /Device voice/ }));
    expect(localStorage.getItem('vinax.aiVoice')).toBe('device');

    // jsdom cannot record, so the dictation list says so and the mic stays on the device.
    const dictation = within(dialog).getByRole('radiogroup', { name: 'Dictation' });
    expect(within(dictation).getByRole('radio', { name: /Device/ }).getAttribute('aria-checked')).toBe('true');
    await waitFor(() => expect(dialog.textContent).toMatch(/can’t record for a dictation model/));
  });
});
