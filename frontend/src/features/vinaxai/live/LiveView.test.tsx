// @vitest-environment jsdom
/**
 * Live voice's loudspeaker / earpiece button: only in an Android app that has
 * the route plugin, remembered for next time; an older app says how to get it;
 * the web shows neither.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({
  cap: { native: true, plugin: true },
  route: 'speaker' as string | null,
  opts: null as null | { speaker?: boolean; language?: string; voice?: string },
  setOptions: vi.fn(),
  state: 'listening',
  setSpeaker: vi.fn(async (on: boolean) => (on ? 'speaker' : 'earpiece')),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => h.cap.native,
    isPluginAvailable: (name: string) => h.cap.native && h.cap.plugin && name === 'VinaxAudioRoute',
    getPlatform: () => (h.cap.native ? 'android' : 'web'),
  },
  registerPlugin: () => ({}),
}));
vi.mock('../musicHold', () => ({ holdMusic: () => () => undefined }));
vi.mock('../api', () => ({ saveLiveTranscript: vi.fn(), voiceNotice: (c: string) => c }));
vi.mock('./liveSession', () => ({
  LiveSession: class {
    transcript = { turns: () => [] };
    model = null;
    search = false;
    constructor(opts: { speaker?: boolean }, private readonly cb: { onRoute?(r: string | null): void; onState(s: string): void }) {
      h.opts = opts;
    }
    setOptions = h.setOptions;
    async start() {
      this.cb.onState(h.state);
      if (h.cap.native && h.cap.plugin) this.cb.onRoute?.(h.route);
    }
    setSpeaker = async (on: boolean) => {
      const r = await h.setSpeaker(on);
      this.cb.onRoute?.(r);
      return r;
    };
    stop() { /* */ }
    setMuted() { /* */ }
    async setSearch() { /* */ }
    async switchMic() { /* */ }
  },
}));

import LiveView from './LiveView';
import { PREFS_KEY, usePrefs } from '../prefs';

const view = () => render(<LiveView conversationId={null} parentMessageId={null} thinking={false} voice="Kore" model="auto" micId="" onClose={() => undefined} />);

beforeEach(() => {
  h.cap.native = true;
  h.cap.plugin = true;
  h.route = 'speaker';
  h.setSpeaker.mockClear();
  h.setOptions.mockClear();
  h.state = 'listening';
  localStorage.clear();
  usePrefs.getState().set({ liveSpeaker: true });
});
afterEach(cleanup);

describe('Live voice: the loudspeaker button', () => {
  it('shows in the app with the plugin, starts on the loudspeaker, and remembers a switch to the earpiece', async () => {
    view();
    const btn = await screen.findByRole('button', { name: 'Loudspeaker' });
    expect(h.opts?.speaker).toBe(true);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    await act(async () => { fireEvent.click(btn); });
    expect(h.setSpeaker).toHaveBeenCalledWith(false);
    expect(screen.getByRole('button', { name: 'Loudspeaker' }).getAttribute('aria-pressed')).toBe('false');
    expect(usePrefs.getState().liveSpeaker).toBe(false);
    expect(JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}').liveSpeaker).toBe(false);
    expect(screen.queryByText(/Update the VinaX app/)).toBeNull();
  });

  it('starts on the earpiece when that was the last choice', async () => {
    usePrefs.getState().set({ liveSpeaker: false });
    h.route = 'earpiece';
    view();
    const btn = await screen.findByRole('button', { name: 'Loudspeaker' });
    expect(h.opts?.speaker).toBe(false);
    expect(btn.getAttribute('aria-pressed')).toBe('false');
  });

  it('an app built before the plugin: no button, and a line saying an update brings it', async () => {
    h.cap.plugin = false;
    view();
    await screen.findByText(/Update the VinaX app to switch between the loudspeaker and the earpiece/);
    expect(screen.queryByRole('button', { name: 'Loudspeaker' })).toBeNull();
  });

  it('the web: neither', async () => {
    h.cap.native = false;
    view();
    await screen.findByRole('button', { name: 'End' });
    expect(screen.queryByRole('button', { name: 'Loudspeaker' })).toBeNull();
    expect(screen.queryByText(/Update the VinaX app/)).toBeNull();
  });
});

describe('Live voice: model, voice and language pickers, captions', () => {
  const info = {
    dictation: true, readAloud: true, live: true, voices: ['troy'], liveVoices: ['Kore', 'Puck'],
    liveModels: [{ id: 'gemini-3.8-live', name: 'Gemini 3.8 Live' }],
    liveLanguages: [{ code: 'en', name: 'English', native: 'English' }, { code: 'te', name: 'Telugu', native: 'తెలుగు' }],
  };
  const withInfo = () => render(<LiveView conversationId={null} parentMessageId={null} thinking={false} voice="Kore" model="auto" micId="" voiceInfo={info} onClose={() => undefined} />);

  it('shows the pickers while it is still connecting, and a choice is remembered and applied to the call', async () => {
    h.cap.native = false;
    h.state = 'connecting';
    usePrefs.getState().set({ liveLanguage: 'en' });
    withInfo();
    await screen.findByText('Connecting…');
    expect(h.opts).toMatchObject({ language: 'en', voice: 'Kore' });
    const voice = screen.getByRole('combobox', { name: 'Voice' });
    expect(screen.getByRole('option', { name: 'Puck · Upbeat' })).toBeTruthy();
    fireEvent.change(voice, { target: { value: 'Puck' } });
    expect(h.setOptions).toHaveBeenLastCalledWith({ voice: 'Puck' });
    expect(usePrefs.getState().liveVoice).toBe('Puck');
    fireEvent.change(screen.getByRole('combobox', { name: 'Language' }), { target: { value: 'te' } });
    expect(h.setOptions).toHaveBeenLastCalledWith({ language: 'te' });
    expect(usePrefs.getState().liveLanguage).toBe('te');
    fireEvent.change(screen.getByRole('combobox', { name: 'Model' }), { target: { value: 'gemini-3.8-live' } });
    expect(h.setOptions).toHaveBeenLastCalledWith({ model: 'gemini-3.8-live' });
    expect(usePrefs.getState().liveModel).toBe('gemini-3.8-live');
  });

  it('the captions button hides and shows what is said, and is remembered', async () => {
    h.cap.native = false;
    usePrefs.getState().set({ liveCaptions: true });
    withInfo();
    const cc = await screen.findByRole('button', { name: 'Captions' });
    expect(cc.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(cc);
    expect(usePrefs.getState().liveCaptions).toBe(false);
    expect(screen.getByRole('button', { name: 'Captions' }).getAttribute('aria-pressed')).toBe('false');
  });
});
