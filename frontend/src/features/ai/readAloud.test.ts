// @vitest-environment jsdom
/**
 * Read aloud (v5.27.0) — the studio voice with a device fallback.
 *
 * The failure that matters here is not "no sound": it is speaking a reply
 * TWICE, once through each path, or leaving the button stuck in the speaking
 * state after a failure. These tests pin both.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHUNK_LEASH_MS, readAloud, setReadAloudVoice, speakableText, stopReadAloud, onSpeakingChange } from './readAloud';

const PICK = { model: 'canopylabs/orpheus-v1-english', voice: 'autumn' };

let spoken: string[] = [];
let cancels = 0;

class FakeUtterance {
  text: string;
  voice: unknown = null;
  rate = 1;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

beforeEach(() => {
  spoken = [];
  cancels = 0;
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
  vi.stubGlobal('speechSynthesis', {
    cancel: () => { cancels += 1; },
    speak: (u: FakeUtterance) => {
      spoken.push(u.text);
      // Resolve asynchronously, the way a real engine does.
      setTimeout(() => u.onend?.(), 0);
    },
    getVoices: () => [],
  });
  setReadAloudVoice(null);
});

afterEach(() => {
  stopReadAloud();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const audioBlob = (): Blob => new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' });

/** An Audio element that "plays" instantly and successfully. */
function stubAudio(ok = true): void {
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined });
  vi.stubGlobal(
    'Audio',
    class {
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      play(): Promise<void> {
        setTimeout(() => (ok ? this.onended?.() : this.onerror?.()), 0);
        return Promise.resolve();
      }
      pause(): void {}
      set src(_v: string) {}
    },
  );
}

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 20));

describe('speakableText', () => {
  it('flattens markdown and drops the follow-up line', () => {
    const out = speakableText('# Title\n\n- one\n- two\n\n```js\ncode\n```\n\n>>> a | b');
    expect(out).toContain('Title');
    expect(out).toContain('(code block)');
    expect(out).not.toContain('>>>');
    expect(out).not.toContain('#');
  });
});

describe('device voice (no choice set)', () => {
  it('speaks on the device and never calls the network', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    readAloud('m1', 'Hello there.');
    await settle();
    expect(spoken).toEqual(['Hello there.']);
    expect(f).not.toHaveBeenCalled();
  });
});

describe('studio voice', () => {
  it('sends the chosen model and persona, and does NOT also speak on the device', async () => {
    const f = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(new Response(audioBlob(), { status: 200, headers: { 'content-type': 'audio/wav' } })),
    );
    vi.stubGlobal('fetch', f);
    stubAudio();
    setReadAloudVoice(() => PICK);
    readAloud('m1', 'Hello there.');
    await settle();
    const body = JSON.parse(String(f.mock.calls[0][1]?.body)) as Record<string, string>;
    expect(body.model).toBe(PICK.model);
    expect(body.voice).toBe(PICK.voice);
    // The whole point: one voice, not two.
    expect(spoken).toEqual([]);
  });

  it('10.3 — names the provider of the chosen voice in the request', async () => {
    const f = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(new Response(audioBlob(), { status: 200, headers: { 'content-type': 'audio/wav' } })),
    );
    vi.stubGlobal('fetch', f);
    stubAudio();
    setReadAloudVoice(() => ({ provider: 'gemini', model: 'speech-1', voice: 'Kore' }));
    readAloud('m-provider', 'Hello there.');
    await settle();
    expect(JSON.parse(String(f.mock.calls[0][1]?.body))).toEqual({ text: 'Hello there.', provider: 'gemini', model: 'speech-1', voice: 'Kore' });
  });

  it('falls back to the device when the first chunk fails, speaking it exactly once', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('nope', { status: 502 }))));
    stubAudio();
    setReadAloudVoice(() => PICK);
    readAloud('m1', 'Hello there.');
    await settle();
    expect(spoken).toEqual(['Hello there.']);
  });

  it('falls back when the reply comes back as JSON rather than audio', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({ error: 'not_configured' }), { status: 200, headers: { 'content-type': 'application/json' } })),
      ),
    );
    stubAudio();
    setReadAloudVoice(() => PICK);
    readAloud('m1', 'Hello there.');
    await settle();
    expect(spoken).toEqual(['Hello there.']);
  });

  it('falls back when playback itself is refused', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve(new Response(audioBlob(), { status: 200, headers: { 'content-type': 'audio/wav' } })),
    ));
    stubAudio(false);
    setReadAloudVoice(() => PICK);
    readAloud('m1', 'Hello there.');
    await settle();
    expect(spoken).toEqual(['Hello there.']);
  });
});

describe('11.0 — a server voice gets the time the server itself allows', () => {
  /** A voice that answers after `ms`, and honours the caller's abort. */
  const slowVoice = (ms: number | null): ReturnType<typeof vi.fn> =>
    vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          if (ms !== null) setTimeout(() => resolve(new Response(audioBlob(), { status: 200, headers: { 'content-type': 'audio/wav' } })), ms);
        }),
    );

  afterEach(() => {
    vi.useRealTimers();
  });

  it('a voice that needs eight seconds is played, not replaced by the device voice', async () => {
    vi.useFakeTimers();
    const f = slowVoice(8000);
    vi.stubGlobal('fetch', f);
    stubAudio();
    setReadAloudVoice(() => PICK);
    const ids: Array<string | null> = [];
    const off = onSpeakingChange((id) => ids.push(id));
    readAloud('m1', 'Hello there.');
    await vi.advanceTimersByTimeAsync(8200);
    off();
    expect(f).toHaveBeenCalledTimes(1);
    expect((f.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(false);
    // Spoken by the server voice to the end — the device never speaks.
    expect(spoken).toEqual([]);
    expect(ids.slice(-2)).toEqual(['m1', null]);
  });

  it('a voice that never answers still hands over to the device voice', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', slowVoice(null));
    stubAudio();
    setReadAloudVoice(() => PICK);
    readAloud('m1', 'Hello there.');
    await vi.advanceTimersByTimeAsync(CHUNK_LEASH_MS - 100);
    expect(spoken).toEqual([]);
    await vi.advanceTimersByTimeAsync(300);
    expect(spoken).toEqual(['Hello there.']);
  });
});

describe('cancellation', () => {
  it('a cancelled turn never falls back afterwards', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => { /* hangs */ })));
    stubAudio();
    setReadAloudVoice(() => PICK);
    readAloud('m1', 'Hello there.');
    stopReadAloud();
    await settle();
    expect(spoken).toEqual([]);
  });

  it('reports the speaking id, then clears it when the reply ends', async () => {
    const seen: Array<string | null> = [];
    const off = onSpeakingChange((id) => seen.push(id));
    vi.stubGlobal('fetch', vi.fn());
    readAloud('m1', 'Hello there.');
    await settle();
    off();
    // readAloud stops whatever was speaking first, so a leading null is
    // expected — what matters is that the id is announced and then cleared.
    expect(seen).toContain('m1');
    expect(seen[seen.length - 1]).toBeNull();
  });

  it('tapping the speaking reply again stops it', async () => {
    vi.stubGlobal('fetch', vi.fn());
    readAloud('m1', 'Hello there.');
    const before = cancels;
    readAloud('m1', 'Hello there.');
    expect(cancels).toBeGreaterThan(before);
  });
});
