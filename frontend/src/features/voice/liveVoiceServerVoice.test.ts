// @vitest-environment jsdom
/** 11.2 — voice mode speaks in the CHOSEN voice: server vs device, and the
 *  quiet hand-over to the device voice when the chosen one fails. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveVoiceEngine, type ServerVoiceStatus } from './liveVoiceEngine';
import { voiceFallbackNotice } from '@/features/ai/chat/useLiveVoice';

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

const PICK = { provider: 'gemini', model: 'flash-tts', voice: 'Kore' };

function run(getServerVoice: () => typeof PICK | null) {
  const status: ServerVoiceStatus[] = [];
  const fatals: string[] = [];
  const engine = new LiveVoiceEngine(
    { lang: 'en-IN', getVoice: () => null, toSpoken: (s) => s, getServerVoice },
    {
      onState: () => {},
      onLevel: () => {},
      onUserInterim: () => {},
      onUserFinal: () => {},
      onAssistantCaption: () => {},
      onFatal: (r) => fatals.push(r),
      onServerVoice: (s) => status.push(s),
    },
  );
  (engine as unknown as { beginTurn: () => void }).beginTurn();
  engine.feed('Hi there. All good.');
  engine.finish();
  return { engine, status, fatals };
}

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 60));

describe('voice mode — which voice speaks the reply', () => {
  it('speaks in the chosen provider/model/voice through /api/tts', async () => {
    const fetchMock = vi.fn((_u: string, _i?: { body?: string }) =>
      Promise.resolve({ ok: true, status: 200, headers: { get: () => 'audio/wav' }, blob: () => Promise.resolve({ size: 64 } as unknown as Blob) } as unknown as Response),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { engine, status, fatals } = run(() => PICK);
    await settle();
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as Record<string, string>;
    expect(fetchMock.mock.calls[0][0]).toBe('/api/tts');
    expect(body).toEqual({ text: 'Hi there.', ...PICK });
    expect(played.length).toBeGreaterThanOrEqual(2);
    expect(spoken).toEqual([]);
    expect(status).toContain('ok');
    expect(status).not.toContain('quota');
    expect(fatals).toEqual([]);
    engine.destroy();
  });

  it('device voice chosen: no request at all, the device speaks, no notice', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { engine, status } = run(() => null);
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(spoken.map((u) => u.text.trim())).toEqual(expect.arrayContaining(['Hi there.', 'All good.']));
    expect(status).toEqual([]);
    engine.destroy();
  });

  it('chosen voice out of quota (429): the device voice finishes the turn and says why', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 429, headers: { get: () => 'application/json' } } as unknown as Response)));
    const { engine, status, fatals } = run(() => PICK);
    await settle();
    expect(spoken.map((u) => u.text.trim())).toEqual(expect.arrayContaining(['Hi there.', 'All good.']));
    expect(played).toEqual([]);
    expect(status).toEqual(['quota']);
    expect(fatals).toEqual([]);
    engine.destroy();
  });

  it('chosen voice errors: device voice takes over, reported as unavailable — never silence', async () => {
    // beforeEach's fetch rejects.
    const { engine, status, fatals } = run(() => PICK);
    await settle();
    expect(spoken.length).toBeGreaterThanOrEqual(2);
    expect(status).toEqual(['unavailable']);
    expect(fatals).toEqual([]);
    engine.destroy();
  });

  it('the notice is quiet text, cleared when the chosen voice speaks again', () => {
    expect(voiceFallbackNotice('quota')).toMatch(/out of quota/);
    expect(voiceFallbackNotice('unavailable')).toMatch(/device’s voice is speaking/);
    expect(voiceFallbackNotice('ok')).toBe('');
  });
});
