// @vitest-environment jsdom
/** Locks the send()->engine.feed()->TTS wiring so a future refactor can't break
 *  the voice-mode reply path again. If feed() delivers a sentence but speak()
 *  is never called, or finish() doesn't drain the tail, this test fails. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveVoiceEngine, isLikelyEcho } from './liveVoiceEngine';

interface FakeUtter {
  text: string;
  voice: unknown;
  lang: string;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  onboundary: (() => void) | null;
}

const FakeSpeechRecognition = class {
  lang = '';
  continuous = false;
  interimResults = false;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  onaudiostart: (() => void) | null = null;
  start(): void {
    /* no-op — the tests drive feed()/finish() directly */
  }
  stop(): void {}
  abort(): void {}
};

let spoken: FakeUtter[] = [];
let played: string[] = [];
let synthesisCancel: ReturnType<typeof vi.fn>;
let synthesisResume: ReturnType<typeof vi.fn>;

/** Server-voice media stubs: jsdom has no play()/createObjectURL, so playback
 *  is simulated — play() fires onplaying then onended, like a real element. */
interface MediaHandlers {
  src: string;
  onplaying: ((e: Event) => void) | null;
  onended: ((e: Event) => void) | null;
}

beforeEach(() => {
  spoken = [];
  played = [];
  // Server voice is DOWN by default — existing tests exercise the browser
  // fallback exactly as before; the success test overrides this stub.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new TypeError('offline'))),
  );
  (URL as unknown as { createObjectURL: (b: unknown) => string }).createObjectURL = () => 'blob:vinax-test';
  (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = () => {};
  HTMLMediaElement.prototype.play = function (this: HTMLMediaElement & MediaHandlers) {
    played.push(this.src);
    setTimeout(() => this.onplaying?.(new Event('playing')), 0);
    setTimeout(() => this.onended?.(new Event('ended')), 5);
    return Promise.resolve();
  };
  HTMLMediaElement.prototype.pause = function () {};
  HTMLMediaElement.prototype.load = function () {};
  synthesisCancel = vi.fn();
  synthesisResume = vi.fn();
  (globalThis as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeSpeechRecognition;
  (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeSpeechRecognition;
  (window as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = class {
    text: string;
    voice: unknown = null;
    lang = '';
    onstart: (() => void) | null = null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onboundary: (() => void) | null = null;
    volume = 1;
    rate = 1;
    constructor(t: string) {
      this.text = t;
    }
  };
  (window as unknown as { speechSynthesis: unknown }).speechSynthesis = {
    speak(u: FakeUtter) {
      spoken.push(u);
      // simulate an async start-then-end so the queue advances
      setTimeout(() => {
        u.onstart?.();
        setTimeout(() => u.onend?.(), 1);
      }, 0);
    },
    cancel: synthesisCancel,
    resume: synthesisResume,
    paused: false,
    getVoices: () => [],
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('LiveVoiceEngine — voice-mode reply wiring (v2.5.2 lock)', () => {
  it('feed(delta) queues speech once a sentence closes; finish() speaks the tail', async () => {
    const states: string[] = [];
    const captions: string[] = [];
    const fatals: string[] = [];
    const engine = new LiveVoiceEngine(
      { lang: 'en-IN', getVoice: () => null, toSpoken: (s) => s },
      {
        onState: (s) => states.push(s),
        onLevel: () => {},
        onUserInterim: () => {},
        onUserFinal: () => {},
        onAssistantCaption: (t) => captions.push(t),
        onFatal: (r) => fatals.push(r),
      },
    );
    // Simulate the point where the mic delivered a final transcript and the
    // page began streaming a reply — beginTurn puts us in 'thinking'.
    (engine as unknown as { beginTurn: () => void }).beginTurn();

    // Stream three deltas that form two sentences + a tail.
    engine.feed('Hi there.');
    engine.feed(' All good');
    engine.feed('? Yes.');
    engine.feed(' Tail');
    engine.finish();

    // Drain microtasks + timers so speak()/onstart/onend chains complete.
    await new Promise((r) => setTimeout(r, 30));

    // Three sentences: "Hi there.", "All good? Yes.", "Tail" (tail flushed by finish()).
    const texts = spoken.map((u) => u.text.trim());
    expect(texts.length).toBeGreaterThanOrEqual(3);
    expect(texts[0]).toBe('Hi there.');
    expect(captions.length).toBeGreaterThan(0);
    expect(fatals).toEqual([]);
    engine.destroy();
  });

  it('finish(fullText) speaks the reply even when no deltas ever streamed', async () => {
    const captions: string[] = [];
    const engine = new LiveVoiceEngine(
      { lang: 'en-IN', getVoice: () => null, toSpoken: (s) => s },
      {
        onState: () => {},
        onLevel: () => {},
        onUserInterim: () => {},
        onUserFinal: () => {},
        onAssistantCaption: (t) => captions.push(t),
        onFatal: () => {},
      },
    );
    (engine as unknown as { beginTurn: () => void }).beginTurn();
    engine.finish('The whole reply arrived at once.');

    await new Promise((r) => setTimeout(r, 30));

    expect(spoken.map((u) => u.text)).toContain('The whole reply arrived at once.');
    expect(captions).toContain('The whole reply arrived at once.');
    engine.destroy();
  });

  it('fires onFatal("no-tts") when speak() never starts (dead synth)', async () => {
    const fatals: string[] = [];
    // Replace speak with a no-op — onstart never fires.
    (window as unknown as { speechSynthesis: { speak: (u: FakeUtter) => void; cancel: () => void; resume: () => void; paused: boolean; getVoices: () => unknown[] } }).speechSynthesis = {
      speak: () => {
        /* never fires onstart — mimics a synth that silently swallows utterances */
      },
      cancel: () => {},
      resume: () => {},
      paused: false,
      getVoices: () => [],
    };
    const engine = new LiveVoiceEngine(
      { lang: 'en-IN', getVoice: () => null, toSpoken: (s) => s },
      {
        onState: () => {},
        onLevel: () => {},
        onUserInterim: () => {},
        onUserFinal: () => {},
        onAssistantCaption: () => {},
        onFatal: (r) => fatals.push(r),
      },
    );
    (engine as unknown as { beginTurn: () => void }).beginTurn();
    engine.feed('Hello there. ');
    engine.finish();
    // First watchdog: 2500ms + retry: another 2500ms => onFatal by 5s. Wait a
    // bit more so the retry chain settles. Real timers — window.setTimeout in
    // jsdom isn't intercepted by vi.useFakeTimers reliably.
    await new Promise((r) => setTimeout(r, 5400));
    expect(fatals).toContain('no-tts');
    engine.destroy();
  }, 10000);

  it('speaks via the server voice when /api/tts answers audio — browser synth stays silent', async () => {
    const fetchMock = vi.fn((_url: string, init?: { body?: string }) => {
      void init;
      return Promise.resolve({
        ok: true,
        headers: { get: () => 'audio/wav' },
        blob: () => Promise.resolve({ size: 64 } as unknown as Blob),
      } as unknown as Response);
    });
    vi.stubGlobal('fetch', fetchMock);
    const captions: string[] = [];
    const fatals: string[] = [];
    const engine = new LiveVoiceEngine(
      { lang: 'en-IN', getVoice: () => null, toSpoken: (s) => s },
      {
        onState: () => {},
        onLevel: () => {},
        onUserInterim: () => {},
        onUserFinal: () => {},
        onAssistantCaption: (t) => captions.push(t),
        onFatal: (r) => fatals.push(r),
      },
    );
    (engine as unknown as { beginTurn: () => void }).beginTurn();
    engine.feed('Hi there. All good.');
    engine.finish();

    await new Promise((r) => setTimeout(r, 60));

    // Both sentences fetched from the server voice and played as audio…
    expect(fetchMock).toHaveBeenCalled();
    const bodies = fetchMock.mock.calls.map((c) => JSON.parse((c[1] as { body: string }).body) as { text: string });
    expect(bodies.map((b) => b.text)).toEqual(expect.arrayContaining(['Hi there.', 'All good.']));
    expect(played.length).toBeGreaterThanOrEqual(2);
    // …captions still flow, the browser synth never speaks, no fatals.
    expect(captions).toEqual(expect.arrayContaining(['Hi there.', 'All good.']));
    expect(spoken).toEqual([]);
    expect(fatals).toEqual([]);
    engine.destroy();
  });

  it('falls back to browser synth for the rest of the turn when the server voice errors', async () => {
    // Default beforeEach fetch stub rejects — the server voice is down.
    const captions: string[] = [];
    const fatals: string[] = [];
    const engine = new LiveVoiceEngine(
      { lang: 'en-IN', getVoice: () => null, toSpoken: (s) => s },
      {
        onState: () => {},
        onLevel: () => {},
        onUserInterim: () => {},
        onUserFinal: () => {},
        onAssistantCaption: (t) => captions.push(t),
        onFatal: (r) => fatals.push(r),
      },
    );
    (engine as unknown as { beginTurn: () => void }).beginTurn();
    engine.feed('Hi there. All good.');
    engine.finish();

    await new Promise((r) => setTimeout(r, 60));

    // Every sentence still gets SPOKEN — by the browser voice — and once the
    // first fetch fails the rest of the turn skips the server entirely.
    const texts = spoken.map((u) => u.text.trim());
    expect(texts).toEqual(expect.arrayContaining(['Hi there.', 'All good.']));
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    expect(played).toEqual([]);
    expect(fatals).toEqual([]);
    engine.destroy();
  });
});

describe('isLikelyEcho (B6 barge-in echo filter)', () => {
  it('treats a substring of the spoken text as echo', () => {
    expect(isLikelyEcho('the whole reply', 'here is the whole reply for you')).toBe(true);
  });
  it('treats reordered spoken words as echo', () => {
    expect(isLikelyEcho('reply whole', 'the whole reply arrived')).toBe(true);
  });
  it('does NOT treat genuinely different speech as echo', () => {
    expect(isLikelyEcho('stop play something else', 'here are three romantic songs')).toBe(false);
  });
  it('ignores empty heard text (not a barge-in)', () => {
    expect(isLikelyEcho('', 'anything')).toBe(true);
  });
  it('is punctuation/case insensitive', () => {
    expect(isLikelyEcho('HELLO, THERE!', 'well hello there friend')).toBe(true);
  });
});

describe('pauseSpeaking (B6 barge-in state machine)', () => {
  it('cancels TTS and returns to listening from speaking', () => {
    const states: string[] = [];
    const engine = new LiveVoiceEngine(
      { lang: 'en-IN', getVoice: () => null, toSpoken: (s) => s },
      {
        onState: (s) => states.push(s),
        onLevel: () => {},
        onUserInterim: () => {},
        onUserFinal: () => {},
        onAssistantCaption: () => {},
        onFatal: () => {},
      },
    );
    (engine as unknown as { beginTurn: () => void }).beginTurn(); // -> thinking
    // finish(fullText) with nothing streamed speaks it directly -> speaking (sync).
    engine.finish('Here is a long spoken reply.');
    expect(states[states.length - 1]).toBe('speaking');

    engine.pauseSpeaking(); // barge-in path
    expect(states[states.length - 1]).toBe('listening');
    expect(synthesisCancel).toHaveBeenCalled();
    engine.destroy();
  });

  it('is a no-op when not speaking', () => {
    const states: string[] = [];
    const engine = new LiveVoiceEngine(
      { lang: 'en-IN', getVoice: () => null, toSpoken: (s) => s },
      {
        onState: (s) => states.push(s),
        onLevel: () => {},
        onUserInterim: () => {},
        onUserFinal: () => {},
        onAssistantCaption: () => {},
        onFatal: () => {},
      },
    );
    // idle — never spoke. pauseSpeaking must do nothing.
    engine.pauseSpeaking();
    expect(states).toEqual([]);
    engine.destroy();
  });
});
