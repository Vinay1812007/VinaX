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
  opts: null as null | { speaker?: boolean },
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
    async start() {
      this.cb.onState('listening');
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
