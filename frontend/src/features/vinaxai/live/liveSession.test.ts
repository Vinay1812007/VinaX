// @vitest-environment jsdom
/**
 * Live voice in the Android app: the loudspeaker route (and its absence in
 * an older APK), the echo guard that keeps VinaX AI from hearing itself, the
 * reconnect after a dropped connection, and the route plugin's wrapper.
 * The audio, the socket and the plugin are stand-ins.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  cap: { native: true, plugin: true },
  log: [] as string[],
  plugin: {
    start: vi.fn(async ({ speaker }: { speaker: boolean }) => { h.log.push(`route:${speaker ? 'speaker' : 'earpiece'}`); return { route: speaker ? 'speaker' : 'earpiece' }; }),
    setSpeaker: vi.fn(async ({ on }: { on: boolean }) => ({ route: on ? 'speaker' : 'earpiece' })),
    getRoute: vi.fn(async () => ({ route: 'speaker' })),
    stop: vi.fn(async () => { h.log.push('route:stop'); }),
  },
  liveToken: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => h.cap.native,
    isPluginAvailable: (name: string) => h.cap.native && h.cap.plugin && name === 'VinaxAudioRoute',
    getPlatform: () => (h.cap.native ? 'android' : 'web'),
  },
  registerPlugin: () => h.plugin,
}));
vi.mock('@/features/voice/stt', () => ({ nativeMicPermission: async () => true }));
vi.mock('../api', () => ({ liveToken: h.liveToken }));

import { LiveSession, type LiveCallbacks } from './liveSession';
import { EchoGuard } from './liveProtocol';
import { audioRouteAvailable, setSpeaker, startAudioRoute, stopAudioRoute } from './audioRoute';

// ---------- stand-ins ----------

class FakeNode {
  connect<T>(n: T): T { return n; }
  disconnect(): void { /* */ }
}

class FakeCtx {
  static made: FakeCtx[] = [];
  state: AudioContextState = 'running';
  sampleRate = 48_000;
  currentTime = 0;
  destination = new FakeNode();
  onstatechange: (() => void) | null = null;
  audioWorklet = { addModule: vi.fn(async () => undefined) };
  resume = vi.fn(async () => { this.state = 'running'; });
  close = vi.fn(async () => { this.state = 'closed'; });
  constructor() { FakeCtx.made.push(this); h.log.push('ctx'); }
  createGain() { return Object.assign(new FakeNode(), { gain: { value: 1 } }); }
  createAnalyser() { return Object.assign(new FakeNode(), { fftSize: 0, getFloatTimeDomainData: (b: Float32Array) => b.fill(0) }); }
  createMediaStreamSource() { return new FakeNode(); }
  createBuffer(_ch: number, len: number, rate: number) { const d = new Float32Array(len); return { duration: len / rate, getChannelData: () => d }; }
  createBufferSource() { return Object.assign(new FakeNode(), { buffer: null, onended: null, start: vi.fn(), stop: vi.fn() }); }
}

class FakeTap extends FakeNode {
  static last: FakeTap | null = null;
  port: { onmessage: ((e: { data: Float32Array }) => void) | null } = { onmessage: null };
  constructor() { super(); FakeTap.last = this; }
}

class FakeWS {
  static OPEN = 1;
  static all: FakeWS[] = [];
  readyState = 0;
  binaryType = '';
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeWS.all.push(this);
    queueMicrotask(() => { this.readyState = 1; this.onopen?.(); });
  }
  send(d: string) { this.sent.push(d); }
  close() { if (this.readyState === 3) return; this.readyState = 3; this.onclose?.({ code: 1000 }); }
  say(msg: unknown) { this.onmessage?.({ data: JSON.stringify(msg) }); }
  drop() { this.readyState = 3; this.onclose?.({ code: 1006 }); }
}

const track = { label: 'Phone mic', stop: vi.fn(() => { h.log.push('mic:closed'); }), getSettings: () => ({ echoCancellation: true }) };
const stream = { getAudioTracks: () => [track], getTracks: () => [track] };

const callbacks = (): LiveCallbacks & { ends: Array<[string, string | undefined]>; routes: Array<string | null> } => {
  const ends: Array<[string, string | undefined]> = [];
  const routes: Array<string | null> = [];
  return { ends, routes, onState: () => undefined, onCaptions: () => undefined, onLevel: () => undefined, onRoute: (r) => routes.push(r), onEnd: (r, e) => ends.push([r, e]) };
};

const sessionReady = async (s: LiveSession, n = 1): Promise<FakeWS> => {
  await vi.waitFor(() => expect(FakeWS.all.length).toBe(n));
  const ws = FakeWS.all[n - 1];
  await vi.waitFor(() => expect(ws.readyState).toBe(1));
  ws.say({ setupComplete: {} });
  void s;
  return ws;
};

/** Base64 of `n` 16-bit samples of a tone (the voice). */
const voiceChunk = (n = 2400): string => {
  const b = new Uint8Array(n * 2);
  for (let i = 0; i < n; i += 1) { b[i * 2] = 0; b[i * 2 + 1] = 0x20; }
  return btoa(String.fromCharCode(...b));
};
const sentSamples = (ws: FakeWS): Int16Array => {
  const msg = JSON.parse(ws.sent[ws.sent.length - 1]) as { realtimeInput: { audio: { data: string } } };
  const bin = atob(msg.realtimeInput.audio.data);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new Int16Array(bytes.buffer);
};

beforeEach(() => {
  h.cap.native = true;
  h.cap.plugin = true;
  h.log.length = 0;
  FakeCtx.made = [];
  FakeWS.all = [];
  FakeTap.last = null;
  vi.clearAllMocks();
  h.liveToken.mockImplementation(async () => ({ token: 't', url: 'wss://live.example/ws', setup: { model: 'models/m' }, model: { id: 'm', name: 'M' }, search: false }));
  vi.stubGlobal('AudioContext', FakeCtx);
  vi.stubGlobal('AudioWorkletNode', FakeTap);
  vi.stubGlobal('WebSocket', FakeWS);
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => { h.log.push('mic'); return stream; }), enumerateDevices: async () => [] },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Live voice in the Android app: loudspeaker or earpiece', () => {
  it('opens the mic, then puts the voice on the loudspeaker, then makes the voice’s audio (call audio, so the echo canceller hears it)', async () => {
    const cb = callbacks();
    const s = new LiveSession({ thinking: false, voice: 'Kore', speaker: true }, cb);
    const started = s.start();
    await sessionReady(s);
    await started;
    expect(h.log.slice(0, 3)).toEqual(['mic', 'route:speaker', 'ctx']);
    expect(cb.routes).toEqual(['speaker']);
    expect(s.route).toBe('speaker');

    await expect(s.setSpeaker(false)).resolves.toBe('earpiece');
    expect(h.plugin.setSpeaker).toHaveBeenCalledWith({ on: false });
    expect(cb.routes).toEqual(['speaker', 'earpiece']);

    s.stop();
    // The route is put back after the mic is closed.
    expect(h.log.indexOf('route:stop')).toBeGreaterThan(h.log.indexOf('mic:closed'));
    expect(cb.ends).toEqual([['closed', undefined]]);
  });

  it('starts on the earpiece when the listener chose it last time', async () => {
    const s = new LiveSession({ thinking: false, voice: 'Kore', speaker: false }, callbacks());
    const started = s.start();
    await sessionReady(s);
    await started;
    expect(h.plugin.start).toHaveBeenCalledWith({ speaker: false });
    s.stop();
  });

  it('in an app built before the plugin: no route calls, the voice’s audio is made in the tap as on the web, and nothing breaks', async () => {
    h.cap.plugin = false;
    const cb = callbacks();
    const s = new LiveSession({ thinking: false, voice: 'Kore' }, cb);
    const started = s.start();
    await sessionReady(s);
    await started;
    expect(h.log.slice(0, 2)).toEqual(['ctx', 'mic']);
    expect(h.plugin.start).not.toHaveBeenCalled();
    expect(cb.routes).toEqual([]);
    await expect(s.setSpeaker(true)).resolves.toBeNull();
    s.stop();
    expect(h.plugin.stop).not.toHaveBeenCalled();
    expect(cb.ends).toEqual([['closed', undefined]]);
  });

  it('a route plugin that fails leaves Android’s routing and Live goes on', async () => {
    h.plugin.start.mockRejectedValueOnce(new Error('boom'));
    const cb = callbacks();
    const s = new LiveSession({ thinking: false, voice: 'Kore' }, cb);
    const started = s.start();
    await sessionReady(s);
    await started;
    expect(cb.routes).toEqual([null]);
    expect(cb.ends).toEqual([]);
    s.stop();
  });
});

describe('Live voice: VinaX AI does not hear itself', () => {
  const run = async (): Promise<{ s: LiveSession; ws: FakeWS }> => {
    const s = new LiveSession({ thinking: false, voice: 'Kore' }, callbacks());
    const started = s.start();
    const ws = await sessionReady(s);
    await started;
    return { s, ws };
  };
  const mic = (level: number) => FakeTap.last!.port.onmessage!({ data: new Float32Array(4096).fill(level) });

  it('in the app, while the voice plays on the loudspeaker, a quiet mic (its echo) is sent as silence and a loud one (the listener) gets through', async () => {
    const { s, ws } = await run();
    mic(0.005);
    expect(sentSamples(ws).some((x) => x !== 0)).toBe(true);
    ws.say({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: voiceChunk() } }] } } });
    mic(0.005);
    expect(sentSamples(ws).every((x) => x === 0)).toBe(true);
    mic(0.2);
    expect(sentSamples(ws).some((x) => x !== 0)).toBe(true);
    s.stop();
  });

  it('on the earpiece the echo canceller is enough, so nothing is held back', async () => {
    const { s, ws } = await run();
    await s.setSpeaker(false);
    ws.say({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: voiceChunk() } }] } } });
    mic(0.005);
    expect(sentSamples(ws).some((x) => x !== 0)).toBe(true);
    s.stop();
  });

  it('on the web, with the browser’s echo cancellation on, nothing is held back', async () => {
    h.cap.native = false;
    const { s, ws } = await run();
    ws.say({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: voiceChunk() } }] } } });
    mic(0.005);
    expect(sentSamples(ws).some((x) => x !== 0)).toBe(true);
    s.stop();
  });

  it('EchoGuard: silence while the voice plays unless the mic is loud, then holds open for a moment', () => {
    const g = new EchoGuard(0.025, 600);
    const quiet = new Float32Array(10).fill(0.01);
    const loud = new Float32Array(10).fill(0.1);
    expect(g.filter(quiet, false, 0)).toBe(quiet);
    expect([...g.filter(quiet, true, 0)]).toEqual(new Array(10).fill(0));
    expect(g.filter(loud, true, 100)).toBe(loud);
    // A quieter syllable right after still gets through…
    expect(g.filter(quiet, true, 500)).toBe(quiet);
    // …but not once the moment has passed.
    expect([...g.filter(quiet, true, 800)]).toEqual(new Array(10).fill(0));
  });
});

describe('Live voice: a dropped connection', () => {
  it('reconnects with what was said so far, at most twice, then says the connection dropped', async () => {
    const cb = callbacks();
    const s = new LiveSession({ thinking: false, voice: 'Kore' }, cb);
    const started = s.start();
    const first = await sessionReady(s);
    await started;
    first.say({ serverContent: { inputTranscription: { text: 'What is a raga?' } } });
    first.say({ serverContent: { outputTranscription: { text: 'A melody.' }, turnComplete: true } });

    first.drop();
    const second = await sessionReady(s, 2);
    expect(h.liveToken).toHaveBeenCalledTimes(2);
    expect(h.liveToken.mock.calls[1][0]).toMatchObject({ recap: [{ role: 'user', text: 'What is a raga?' }, { role: 'assistant', text: 'A melody.' }] });
    expect(cb.ends).toEqual([]);

    second.drop();
    const third = await sessionReady(s, 3);
    expect(cb.ends).toEqual([]);

    third.drop();
    await vi.waitFor(() => expect(cb.ends).toEqual([['dropped', undefined]]));
    expect(FakeWS.all).toHaveLength(3);
  });

  it('a socket closed by the session itself (ending) does not reconnect', async () => {
    const cb = callbacks();
    const s = new LiveSession({ thinking: false, voice: 'Kore' }, cb);
    const started = s.start();
    await sessionReady(s);
    await started;
    s.stop();
    await Promise.resolve();
    expect(h.liveToken).toHaveBeenCalledTimes(1);
    expect(cb.ends).toEqual([['closed', undefined]]);
  });
});

describe('the route plugin wrapper', () => {
  it('is a quiet no-op on the web and in an older app', async () => {
    h.cap.native = false;
    expect(audioRouteAvailable()).toBe(false);
    await expect(startAudioRoute(true)).resolves.toBeNull();
    await expect(setSpeaker(true)).resolves.toBeNull();
    await expect(stopAudioRoute()).resolves.toBeUndefined();
    h.cap.native = true;
    h.cap.plugin = false;
    expect(audioRouteAvailable()).toBe(false);
    await expect(startAudioRoute(true)).resolves.toBeNull();
    expect(h.plugin.start).not.toHaveBeenCalled();
  });

  it('passes the choice to the app and reads back only routes it knows; a failing plugin never throws', async () => {
    await expect(startAudioRoute(false)).resolves.toBe('earpiece');
    h.plugin.setSpeaker.mockResolvedValueOnce({ route: 'bogus' } as never);
    await expect(setSpeaker(true)).resolves.toBeNull();
    h.plugin.setSpeaker.mockRejectedValueOnce(new Error('x'));
    await expect(setSpeaker(true)).resolves.toBeNull();
    h.plugin.stop.mockRejectedValueOnce(new Error('x'));
    await expect(stopAudioRoute()).resolves.toBeUndefined();
  });
});

describe('Live voice: quicker, switchable, and easy to cut in on', () => {
  beforeEach(() => { h.cap.native = false; h.cap.plugin = false; });

  it('asks for the token while the mic is still opening, not after it', async () => {
    let openMic!: () => void;
    (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise((r) => { openMic = () => { h.log.push('mic'); r(stream); }; }));
    const s = new LiveSession({ thinking: false, voice: 'Kore' }, callbacks());
    void s.start();
    await vi.waitFor(() => expect(h.liveToken).toHaveBeenCalledTimes(1));
    expect(h.log).not.toContain('mic');
    openMic();
    await sessionReady(s);
    s.stop();
  });

  it('sends the language, the chat so far and the personal settings with the token request', async () => {
    const s = new LiveSession({ thinking: false, voice: 'Puck', language: 'te', context: [{ role: 'user', text: 'hi' }], personal: { about: 'drummer' }, conversationId: 'c1', incognito: true }, callbacks());
    void s.start();
    await sessionReady(s);
    expect(h.liveToken.mock.calls[0][0]).toMatchObject({ voice: 'Puck', language: 'te', context: [{ role: 'user', text: 'hi' }], personal: { about: 'drummer' }, conversationId: 'c1', incognito: true });
    expect(h.liveToken.mock.calls[0][0].lean).toBeUndefined();
    s.stop();
  });

  it('a model that refuses the quick setup is asked again without it before the next model', async () => {
    h.liveToken.mockImplementation(async () => ({ token: 't', url: 'wss://live.example/ws', setup: { model: 'models/m' }, model: { id: 'm', name: 'M' }, search: false, tuned: true }));
    const s = new LiveSession({ thinking: false, voice: 'Kore' }, callbacks());
    void s.start();
    await vi.waitFor(() => expect(FakeWS.all.length).toBe(1));
    await vi.waitFor(() => expect(FakeWS.all[0].readyState).toBe(1));
    FakeWS.all[0].readyState = 3;
    FakeWS.all[0].onclose?.({ code: 1007 });
    await sessionReady(s, 2);
    expect(h.liveToken.mock.calls[1][0]).toMatchObject({ lean: true, skip: [] });
    s.stop();
  });

  it('switching the voice, the model or the language reconnects with the new choice and the call so far', async () => {
    const s = new LiveSession({ thinking: false, voice: 'Kore', model: 'auto', language: 'en' }, callbacks());
    void s.start();
    const ws = await sessionReady(s);
    ws.say({ serverContent: { inputTranscription: { text: 'Hello' } } });
    ws.say({ serverContent: { outputTranscription: { text: 'Hi there' }, turnComplete: true } });
    s.setOptions({ voice: 'Puck', language: 'hi' });
    await sessionReady(s, 2);
    expect(h.liveToken.mock.calls[1][0]).toMatchObject({ voice: 'Puck', language: 'hi', recap: [{ role: 'user', text: 'Hello' }, { role: 'assistant', text: 'Hi there' }] });
    // The same choice again changes nothing.
    s.setOptions({ voice: 'Puck' });
    await new Promise((r) => setTimeout(r, 10));
    expect(FakeWS.all.length).toBe(2);
    s.stop();
  });

  it('a switch made while connecting is applied once it is ready', async () => {
    const s = new LiveSession({ thinking: false, voice: 'Kore' }, callbacks());
    void s.start();
    await vi.waitFor(() => expect(FakeWS.all.length).toBe(1));
    s.setOptions({ model: 'gemini-3.8-live' });
    await sessionReady(s, 1);
    await sessionReady(s, 2);
    expect(h.liveToken.mock.calls[1][0]).toMatchObject({ model: 'gemini-3.8-live' });
    s.stop();
  });

  it('tapping to interrupt stops the voice and drops the rest of that reply, until the next turn', async () => {
    const s = new LiveSession({ thinking: false, voice: 'Kore' }, callbacks());
    void s.start();
    const ws = await sessionReady(s);
    await vi.waitFor(() => expect(FakeTap.last).not.toBeNull());
    const ctx = FakeCtx.made[0];
    const played = vi.spyOn(ctx, 'createBufferSource');
    ws.say({ serverContent: { modelTurn: { parts: [{ inlineData: { data: voiceChunk() } }] }, outputTranscription: { text: 'One two' } } });
    expect(played).toHaveBeenCalledTimes(1);
    s.interrupt();
    ws.say({ serverContent: { modelTurn: { parts: [{ inlineData: { data: voiceChunk() } }] }, outputTranscription: { text: ' three four' } } });
    expect(played).toHaveBeenCalledTimes(1);
    ws.say({ serverContent: { turnComplete: true } });
    expect(s.transcript.turns()).toEqual([{ role: 'assistant', text: 'One two' }]);
    ws.say({ serverContent: { modelTurn: { parts: [{ inlineData: { data: voiceChunk() } }] } } });
    expect(played).toHaveBeenCalledTimes(2);
    s.stop();
  });
});
