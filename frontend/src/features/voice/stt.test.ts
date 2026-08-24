// @vitest-environment jsdom
/** Locks the unified STT abstraction (v3.3.0): web sessions ride the Web
 *  Speech API exactly as before, native sessions ride the Capacitor plugin,
 *  and the platform dispatch NEVER constructs the WebView's bare
 *  webkitSpeechRecognition shell (the original Android force-close). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const listeners = new Map<string, Set<(d: unknown) => void>>();
  const plugin = {
    startCalls: [] as Array<Record<string, unknown>>,
    stopCalls: 0,
    permissionResult: 'granted',
    availableResult: true,
    available(): Promise<{ available: boolean }> {
      return Promise.resolve({ available: plugin.availableResult });
    },
    requestPermissions(): Promise<{ speechRecognition: string }> {
      return Promise.resolve({ speechRecognition: plugin.permissionResult });
    },
    start(opts: Record<string, unknown>): Promise<Record<string, never>> {
      plugin.startCalls.push(opts);
      return Promise.resolve({});
    },
    stop(): Promise<void> {
      plugin.stopCalls += 1;
      return Promise.resolve();
    },
    addListener(name: string, fn: (d: unknown) => void): Promise<{ remove: () => Promise<void> }> {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)?.add(fn);
      return Promise.resolve({
        remove: () => {
          listeners.get(name)?.delete(fn);
          return Promise.resolve();
        },
      });
    },
    emit(name: string, d: unknown): void {
      for (const fn of [...(listeners.get(name) ?? [])]) fn(d);
    },
    reset(): void {
      listeners.clear();
      plugin.startCalls = [];
      plugin.stopCalls = 0;
      plugin.permissionResult = 'granted';
      plugin.availableResult = true;
    },
  };
  return { state: { native: false, pluginAvailable: true }, plugin };
});

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => h.state.native,
    isPluginAvailable: () => h.state.pluginAvailable,
  },
  registerPlugin: () => h.plugin,
}));

import { createSttSession, probeSttSupport, resetSttProbeForTests, sttSupported } from './stt';

const flush = async (): Promise<void> => {
  await new Promise((r) => setTimeout(r, 0));
};

class FakeWebRec {
  static instances: FakeWebRec[] = [];
  static throwOnStart = false;
  lang = '';
  continuous = true;
  interimResults = false;
  processLocally?: boolean;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  onaudiostart: (() => void) | null = null;
  started = 0;
  stopped = 0;
  aborted = 0;
  constructor() {
    FakeWebRec.instances.push(this);
  }
  start(): void {
    if (FakeWebRec.throwOnStart) throw new Error('nope');
    this.started += 1;
  }
  stop(): void {
    this.stopped += 1;
  }
  abort(): void {
    this.aborted += 1;
  }
}

beforeEach(() => {
  h.state.native = false;
  h.state.pluginAvailable = true;
  h.plugin.reset();
  resetSttProbeForTests();
  FakeWebRec.instances = [];
  FakeWebRec.throwOnStart = false;
  (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition = FakeWebRec;
});

afterEach(() => {
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
});

describe('stt — web engine', () => {
  it('streams rolling interims and ends with the accumulated final transcript', () => {
    const interims: string[] = [];
    const ends: Array<[string, unknown]> = [];
    const session = createSttSession(
      { lang: 'en-IN', processLocally: true },
      { onInterim: (t) => interims.push(t), onEnd: (t, f) => ends.push([t, f]) },
    );
    expect(session).not.toBeNull();
    const rec = FakeWebRec.instances[0];
    expect(rec.started).toBe(1); // recognition fired synchronously, inside the tap
    expect(rec.lang).toBe('en-IN');
    expect(rec.interimResults).toBe(true);
    expect(rec.continuous).toBe(false);
    expect(rec.processLocally).toBe(true);
    rec.onresult?.({ resultIndex: 0, results: { length: 1, 0: { isFinal: false, 0: { transcript: 'play ' } } } });
    rec.onresult?.({ resultIndex: 0, results: { length: 1, 0: { isFinal: true, 0: { transcript: 'play something' } } } });
    rec.onend?.();
    expect(interims).toEqual(['play ', 'play something']);
    expect(ends).toEqual([['play something', null]]);
  });

  it('maps a permission error to the denied fatal on end', () => {
    const ends: Array<[string, unknown]> = [];
    createSttSession({ lang: 'en-IN' }, { onEnd: (t, f) => ends.push([t, f]) });
    const rec = FakeWebRec.instances[0];
    rec.onerror?.({ error: 'not-allowed' });
    rec.onend?.();
    expect(ends).toEqual([['', 'denied']]);
  });

  it('abort() tears down silently — onEnd never fires after it', () => {
    const ends: string[] = [];
    const session = createSttSession({ lang: 'en-IN' }, { onEnd: (t) => ends.push(t) });
    session?.abort();
    FakeWebRec.instances[0].onend?.();
    expect(FakeWebRec.instances[0].aborted).toBe(1);
    expect(ends).toEqual([]);
  });

  it('returns null (honest unsupported) when no recognition ctor exists', () => {
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    expect(sttSupported()).toBe(false);
    expect(createSttSession({ lang: 'en-IN' }, { onEnd: () => {} })).toBeNull();
  });

  it('returns null when the recognizer refuses to start', () => {
    FakeWebRec.throwOnStart = true;
    expect(createSttSession({ lang: 'en-IN' }, { onEnd: () => {} })).toBeNull();
  });
});

describe('stt — native engine (Android app)', () => {
  beforeEach(() => {
    h.state.native = true;
  });

  it('never touches the WebView SpeechRecognition shell — the plugin listens instead', async () => {
    const session = createSttSession({ lang: 'en-IN' }, { onEnd: () => {} });
    expect(session).not.toBeNull();
    await flush();
    await flush();
    // The web ctor (the old force-close) was never constructed…
    expect(FakeWebRec.instances).toEqual([]);
    // …and the plugin started with partial results, no popup, inside the tap chain.
    expect(h.plugin.startCalls).toEqual([
      { language: 'en-IN', maxResults: 3, partialResults: true, popup: false },
    ]);
    session?.abort();
  });

  it('delivers partial results as interims and the last transcript as the final', async () => {
    const interims: string[] = [];
    const ends: Array<[string, unknown]> = [];
    createSttSession(
      { lang: 'en-IN' },
      { onInterim: (t) => interims.push(t), onEnd: (t, f) => ends.push([t, f]) },
    );
    await flush();
    h.plugin.emit('partialResults', { matches: ['play some'] });
    h.plugin.emit('partialResults', { matches: ['play something calm'] });
    h.plugin.emit('listeningState', { status: 'stopped' });
    // End-of-speech grace: the final combined transcript may land just after.
    await new Promise((r) => setTimeout(r, 600));
    expect(interims).toEqual(['play some', 'play something calm']);
    expect(ends).toEqual([['play something calm', null]]);
  });

  it('ends with the denied fatal when the mic permission is refused in the tap', async () => {
    h.plugin.permissionResult = 'denied';
    const ends: Array<[string, unknown]> = [];
    createSttSession({ lang: 'en-IN' }, { onEnd: (t, f) => ends.push([t, f]) });
    await flush();
    await flush();
    expect(ends).toEqual([['', 'denied']]);
    expect(h.plugin.startCalls).toEqual([]);
  });

  it('gates honestly: plugin missing → unsupported; device probe false → unsupported', async () => {
    h.state.pluginAvailable = false;
    expect(sttSupported()).toBe(false);
    expect(createSttSession({ lang: 'en-IN' }, { onEnd: () => {} })).toBeNull();
    h.state.pluginAvailable = true;
    h.plugin.availableResult = false;
    expect(await probeSttSupport()).toBe(false);
    // The cached probe answer now hides the feature everywhere.
    expect(sttSupported()).toBe(false);
    expect(createSttSession({ lang: 'en-IN' }, { onEnd: () => {} })).toBeNull();
  });

  it('reports supported when the plugin is compiled in and the device has a recognizer', async () => {
    expect(sttSupported()).toBe(true);
    expect(await probeSttSupport()).toBe(true);
    expect(sttSupported()).toBe(true);
  });
});
