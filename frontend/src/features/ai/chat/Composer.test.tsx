// @vitest-environment jsdom
/**
 * The composer (11.0) — three ways a message could be lost or changed behind
 * the listener's back: dictation writing over what was typed, a late
 * dictation result refilling a box that was just sent, and Send going out
 * while the attached files were still being read.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Attachment, FileSelection } from '@/features/ai/attachments';

interface FakeSession {
  cbs: { onInterim?: (t: string) => void; onEnd?: (finalText: string, fatal?: string) => void };
  stop: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
}
const h = vi.hoisted(() => ({
  sessions: [] as FakeSession[],
  prepare: null as null | ((selection: unknown, existing: unknown) => Promise<unknown>),
}));

vi.mock('@/services/location/browserSignals', () => ({ readBrowserSignals: () => ({ country: 'IN', languages: [], timezone: 'Asia/Kolkata' }) }));
vi.mock('@/features/voice/liveVoiceEngine', () => ({ localRecognitionState: () => 'unsupported', prepareLocalRecognition: () => {} }));
vi.mock('@/features/voice/stt', () => ({
  sttSupported: () => true,
  createSttSession: (_opts: unknown, cbs: FakeSession['cbs']) => {
    const session: FakeSession = { cbs, stop: vi.fn(), abort: vi.fn() };
    h.sessions.push(session);
    return session;
  },
}));
vi.mock('@/features/ai/attachments', async (original) => ({
  ...(await original<typeof import('@/features/ai/attachments')>()),
  prepareAttachments: (selection: unknown, existing: unknown) => h.prepare!(selection, existing),
}));

import { Composer, type ComposerHandle, type ComposerProps } from './Composer';

const PICK = { provider: 'groq' as const, model: 'ears-1', name: 'Ears One' };

function setup(over: Partial<ComposerProps> = {}): { onSend: ReturnType<typeof vi.fn>; handle: ComposerHandle; box: () => HTMLTextAreaElement } {
  const onSend = vi.fn();
  const ref = createRef<ComposerHandle>();
  render(
    <Composer
      ref={ref}
      busy={false}
      docked
      modelLabel="Auto"
      modelProvider={null}
      menuOpen={false}
      onToggleMenu={() => {}}
      menu={null}
      think={false}
      onThink={() => {}}
      songCtx={false}
      onSongCtx={() => {}}
      createKind={null}
      onCreateKind={() => {}}
      createBar={null}
      features={{ image: false, speech: false, transcription: false, music: false, code: false, web: false }}
      onToolsOpen={() => {}}
      codeSupport="unknown"
      dictationPick={null}
      canSpeech
      voiceMode={false}
      onToggleVoice={() => {}}
      sendOnEnter
      onSend={onSend}
      onStop={() => {}}
      onOpenPrompts={() => {}}
      {...over}
    />,
  );
  return { onSend, handle: ref.current!, box: () => screen.getByLabelText('Message VinaX AI') as HTMLTextAreaElement };
}

const type = (box: HTMLTextAreaElement, value: string): void => {
  fireEvent.change(box, { target: { value } });
};
const hear = (text: string): void => {
  act(() => {
    h.sessions[h.sessions.length - 1].cbs.onInterim?.(text);
  });
};

beforeEach(() => {
  h.sessions.length = 0;
  h.prepare = null;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('device dictation keeps the typed draft (11.0)', () => {
  it('adds what is heard after what was typed, instead of replacing it', () => {
    const { box } = setup();
    type(box(), 'Make a playlist for ');
    fireEvent.click(screen.getByLabelText('Voice input'));
    expect(h.sessions).toHaveLength(1);
    // The speech session reports the whole utterance so far, each time.
    hear('a rainy');
    expect(box().value).toBe('Make a playlist for a rainy');
    hear('a rainy evening');
    expect(box().value).toBe('Make a playlist for a rainy evening');
  });

  it('an empty box simply receives the transcript', () => {
    const { box } = setup();
    fireEvent.click(screen.getByLabelText('Voice input'));
    hear('play something calm');
    expect(box().value).toBe('play something calm');
  });

  it('sending stops listening, and a result that lands late cannot refill the box', () => {
    const { box, onSend } = setup();
    type(box(), 'Queue');
    fireEvent.click(screen.getByLabelText('Voice input'));
    hear('three songs');
    fireEvent.click(screen.getByLabelText('Send'));
    expect(onSend).toHaveBeenCalledWith('Queue three songs', []);
    expect(h.sessions[0].stop).toHaveBeenCalledTimes(1);
    expect(box().value).toBe('');
    hear('three songs please');
    expect(box().value).toBe('');
  });

  it('keeps the draft when a server dictation model fails over to this device', async () => {
    vi.stubGlobal('MediaRecorder', class {});
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(() => Promise.reject(Object.assign(new Error('no'), { name: 'NotAllowedError' }))) },
    });
    const { box } = setup({ dictationPick: PICK });
    type(box(), 'Remind me');
    fireEvent.click(screen.getByLabelText('Voice input'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(h.sessions).toHaveLength(1);
    hear('to stretch');
    expect(box().value).toBe('Remind me to stretch');
  });
});

describe('server dictation — waiting for the microphone (11.0)', () => {
  it('says it is waiting, and the mic button cancels before anything is recorded', async () => {
    const stopTrack = vi.fn();
    let open: (stream: unknown) => void = () => {};
    vi.stubGlobal('MediaRecorder', class {});
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(() => new Promise((resolve) => (open = resolve))) },
    });
    setup({ dictationPick: PICK });
    fireEvent.click(screen.getByLabelText('Voice input'));
    expect(screen.getByText('Waiting for the microphone…')).toBeTruthy();
    expect(screen.queryByText(/^Recording /)).toBeNull();
    fireEvent.click(screen.getByLabelText('Cancel voice input'));
    expect(screen.queryByText('Waiting for the microphone…')).toBeNull();
    await act(async () => {
      open({ getTracks: () => [{ stop: stopTrack }] });
      await Promise.resolve();
    });
    // The mic that arrived after the cancel is let go, and nothing records.
    expect(stopTrack).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/^Recording /)).toBeNull();
    expect(screen.getByLabelText('Voice input')).toBeTruthy();
  });
});

describe('sending while files are still being read (11.0)', () => {
  it('holds Send until the files are in, then sends them with the message', async () => {
    const file: Attachment = { kind: 'text', name: 'notes.txt', path: 'notes.txt', key: 'k1', size: 12, text: 'hello' };
    let finish: (v: unknown) => void = () => {};
    h.prepare = () => new Promise((resolve) => (finish = resolve));
    const { box, onSend, handle } = setup();
    const selection: FileSelection = { files: [{ file: new File(['hello'], 'notes.txt'), path: 'notes.txt' }], notices: [] };
    act(() => handle.addFiles(selection));
    type(box(), 'Summarise this');

    const send = screen.getByLabelText('Send') as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    // The reason is the visible reading line, tied to the button.
    const reason = document.getElementById(send.getAttribute('aria-describedby') ?? '');
    expect(reason?.getAttribute('role')).toBe('status');
    expect(reason?.textContent).toMatch(/Reading/);
    expect(send.title).toBe('Send unlocks when your files have been read');
    // Enter must not slip past the disabled button either.
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
    expect(box().value).toBe('Summarise this');

    await act(async () => {
      finish({ attachments: [file], notices: [] });
      await Promise.resolve();
    });
    const ready = screen.getByLabelText('Send') as HTMLButtonElement;
    expect(ready.disabled).toBe(false);
    expect(ready.getAttribute('aria-describedby')).toBeNull();
    fireEvent.click(ready);
    expect(onSend).toHaveBeenCalledWith('Summarise this', [file]);
  });
});

describe('composer layouts', () => {
  it('exposes the same controls in the same tab order in the one-row and card layouts', async () => {
    const { layoutAttrs } = await import('./chatStyle');
    const order = (style: 'mono' | 'paper'): string[] => {
      setup();
      const root = document.body;
      const attrs = Object.entries(layoutAttrs(style));
      attrs.forEach(([k, v]) => root.setAttribute(k, v));
      const names = Array.from(root.querySelectorAll<HTMLElement>('.ai-composer-wrap textarea, .ai-composer-wrap button:not([tabindex="-1"])')).map(
        (el) => el.getAttribute('aria-label') ?? el.textContent ?? '',
      );
      cleanup();
      attrs.forEach(([k]) => root.removeAttribute(k));
      return names;
    };
    const oneRow = order('mono');
    const card = order('paper');
    expect(oneRow).toEqual(card);
    expect(oneRow).toContain('Message VinaX AI');
    expect(oneRow.length).toBeGreaterThanOrEqual(4);
    expect(oneRow).toContain('Attach and tools');
    expect(oneRow).toContain('Send');
  });
});

describe('typing while the microphone is listening (11.0)', () => {
  it('keeps what is typed during dictation, after and before the heard words', () => {
    const { box } = setup();
    type(box(), 'Note: ');
    fireEvent.click(screen.getByLabelText('Voice input'));
    hear('buy milk');
    expect(box().value).toBe('Note: buy milk');
    type(box(), 'Note: buy milk (urgent)');
    hear('buy milk and eggs');
    expect(box().value).toBe('Note: buy milk and eggs (urgent)');
    type(box(), 'Shopping note: buy milk and eggs (urgent)');
    hear('buy milk and eggs today');
    expect(box().value).toBe('Shopping note: buy milk and eggs today (urgent)');
  });
  it('heard words the listener rewrote are not written again — only what is said next', () => {
    const { box } = setup();
    fireEvent.click(screen.getByLabelText('Voice input'));
    hear('by milk');
    type(box(), 'buy oat milk');
    hear('by milk and eggs');
    expect(box().value).toBe('buy oat milk and eggs');
    hear('by milk and eggs today');
    expect(box().value).toBe('buy oat milk and eggs today');
  });
});
