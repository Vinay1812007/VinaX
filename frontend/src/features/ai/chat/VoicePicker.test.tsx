// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoicePicker, VoicePickerSheet } from './VoicePicker';
import { PREVIEW_QUOTA, previewLine } from './useVoicePreview';
import type { VoiceCatalog } from './voices';

const CATALOG: VoiceCatalog = {
  configured: true,
  providers: [
    { id: 'groq', label: 'Groq', models: [{ id: 'lab/speak-en', name: 'Speak EN', voices: ['autumn', 'troy'] }] },
    { id: 'gemini', label: 'Gemini', models: [{ id: 'flash-tts', name: 'Flash TTS', voices: ['Kore'] }] },
  ],
};

/** Audio stub: play() resolves; the test ends playback by hand. */
const audios: FakeAudio[] = [];
class FakeAudio {
  src = '';
  paused = true;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    audios.push(this);
  }
  play(): Promise<void> {
    this.paused = false;
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
}

let created: string[] = [];
let revoked: string[] = [];
const audioReply = (): Response =>
  ({ ok: true, status: 200, headers: { get: () => 'audio/wav' }, blob: () => Promise.resolve(new Blob(['x'], { type: 'audio/wav' })) }) as unknown as Response;

beforeEach(() => {
  audios.length = 0;
  created = [];
  revoked = [];
  vi.stubGlobal('Audio', FakeAudio);
  let n = 0;
  (URL as unknown as { createObjectURL: (b: unknown) => string }).createObjectURL = () => {
    const u = `blob:v${(n += 1)}`;
    created.push(u);
    return u;
  };
  (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = (u) => {
    revoked.push(u);
  };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

const mount = (value = 'device', catalog: VoiceCatalog | null = CATALOG) => {
  const onChange = vi.fn<(v: string) => void>();
  const view = render(
    <>
      <p id="lbl">Voice</p>
      <VoicePicker catalog={catalog} value={value} onChange={onChange} labelledBy="lbl" />
    </>,
  );
  return { onChange, ...view };
};

describe('VoicePicker', () => {
  it('groups voices by provider and model, as one radiogroup', () => {
    mount('groq|lab/speak-en|troy');
    const group = screen.getByRole('radiogroup', { name: 'Voice' });
    expect(within(group).getByText('Groq')).toBeTruthy();
    expect(within(group).getByText('Speak EN')).toBeTruthy();
    expect(within(group).getByText('Flash TTS')).toBeTruthy();
    const radios = within(group).getAllByRole('radio');
    expect(radios).toHaveLength(4); // device + autumn + troy + Kore
    expect(screen.getByRole('radio', { name: 'Troy · Speak EN · Groq' }).getAttribute('aria-checked')).toBe('true');
    // Every voice has its own labelled preview.
    for (const n of ['Device voice', 'Autumn', 'Troy', 'Kore']) expect(screen.getByRole('button', { name: `Preview ${n}` })).toBeTruthy();
  });

  it('picks with a click and with arrow keys (previews are not radios)', () => {
    const { onChange } = mount('device');
    fireEvent.click(screen.getByRole('radio', { name: 'Kore · Flash TTS · Gemini' }));
    expect(onChange).toHaveBeenLastCalledWith('gemini|flash-tts|Kore');
    const device = screen.getByRole('radio', { name: /Device voice/ });
    device.focus();
    fireEvent.keyDown(device, { key: 'ArrowDown' });
    expect(onChange).toHaveBeenLastCalledWith('groq|lab/speak-en|autumn');
  });

  it('previews exactly that provider, model and voice — once, then from memory', async () => {
    const fetchMock = vi.fn((_u: string, _i?: RequestInit) => Promise.resolve(audioReply()));
    vi.stubGlobal('fetch', fetchMock);
    const { unmount } = mount();
    const btn = screen.getByRole('button', { name: 'Preview Autumn' });
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-busy')).toBe('true');
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as Record<string, string>;
    expect(body).toEqual({ text: previewLine('Autumn'), provider: 'groq', model: 'lab/speak-en', voice: 'autumn' });
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/tts$/);
    expect(audios[0].src).toBe('blob:v1');
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.getAttribute('aria-busy')).toBe('false');
    // Finished → idle; tapping again replays from memory, no new request.
    act(() => audios[0].onended?.());
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(btn);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    // The cached sample is released when the picker goes away.
    unmount();
    expect(revoked).toEqual(['blob:v1']);
  });

  it('tapping another voice stops the first; tapping the playing one stops it', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(audioReply())));
    mount();
    const autumn = screen.getByRole('button', { name: 'Preview Autumn' });
    const kore = screen.getByRole('button', { name: 'Preview Kore' });
    fireEvent.click(autumn);
    await flush();
    expect(autumn.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(kore);
    expect(audios[0].paused).toBe(true);
    expect(autumn.getAttribute('aria-pressed')).toBe('false');
    await flush();
    expect(kore.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(kore);
    expect(kore.getAttribute('aria-pressed')).toBe('false');
    expect(audios[0].paused).toBe(true);
  });

  it('shows an out-of-quota error on that voice, and tries again on the next tap', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: false, status: 429, headers: { get: () => 'application/json' } } as unknown as Response));
    vi.stubGlobal('fetch', fetchMock);
    mount();
    const troy = screen.getByRole('button', { name: 'Preview Troy' });
    fireEvent.click(troy);
    await flush();
    expect(troy.className).toContain('is-error');
    expect(troy.getAttribute('title')).toBe(PREVIEW_QUOTA);
    expect(screen.getByRole('status').textContent).toBe(`Troy: ${PREVIEW_QUOTA}`);
    expect(created).toEqual([]);
    fireEvent.click(troy);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('previews the device voice through the browser speech engine', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const spoken: string[] = [];
    vi.stubGlobal(
      'SpeechSynthesisUtterance',
      class {
        text: string;
        voice: unknown = null;
        lang = '';
        onend: (() => void) | null = null;
        onerror: (() => void) | null = null;
        constructor(t: string) {
          this.text = t;
        }
      },
    );
    const synth = { speak: (u: { text: string }) => spoken.push(u.text), cancel: vi.fn(), getVoices: () => [] };
    Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Preview Device voice' }));
    expect(spoken).toEqual([previewLine('Device voice')]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never plays anything on its own', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    mount('groq|lab/speak-en|troy');
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(audios).toHaveLength(0);
  });
});

describe('VoicePickerSheet', () => {
  it('focuses the chosen voice and closes on Escape', async () => {
    const onClose = vi.fn();
    render(<VoicePickerSheet catalog={CATALOG} value="gemini|flash-tts|Kore" onChange={() => undefined} onClose={onClose} />);
    expect(screen.getByRole('dialog')).toBeTruthy();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Kore · Flash TTS · Gemini' }));
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
