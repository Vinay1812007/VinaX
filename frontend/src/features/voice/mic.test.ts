// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MIC_KEY, openMic } from './mic';

/** Devices as the owner's Mac listed them; BlackHole sends exact zeros. */
const DEVICES = [
  { kind: 'audioinput', deviceId: 'blackhole', label: 'BlackHole 2ch (Virtual)' },
  { kind: 'audioinput', deviceId: 'builtin', label: 'MacBook Air Microphone (Built-in)' },
  { kind: 'audioinput', deviceId: 'default', label: 'Default - MacBook Air Microphone (Built-in)' },
];
const SILENT = new Set(['blackhole']);
let browserPick = 'blackhole';
const stopped: string[] = [];

const streamFor = (id: string): MediaStream => {
  const label = DEVICES.find((d) => d.deviceId === id)?.label ?? id;
  const track = { label, getSettings: () => ({ deviceId: id }), stop: () => stopped.push(id) };
  return { getAudioTracks: () => [track], getTracks: () => [track], id } as unknown as MediaStream;
};

class FakeCtx {
  state = 'running';
  private src: MediaStream | null = null;
  createAnalyser(): unknown {
    return {
      fftSize: 2048,
      getFloatTimeDomainData: (buf: Float32Array) => {
        const id = (this.src as unknown as { id: string }).id;
        buf.fill(SILENT.has(id) ? 0 : 0.003);
      },
    };
  }
  createMediaStreamSource(s: MediaStream): unknown {
    this.src = s;
    return { connect: () => undefined };
  }
  resume(): Promise<void> {
    return Promise.resolve();
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}

beforeEach(() => {
  localStorage.clear();
  stopped.length = 0;
  browserPick = 'blackhole';
  vi.stubGlobal('AudioContext', FakeCtx);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      enumerateDevices: async () => DEVICES,
      getUserMedia: vi.fn(async (c: MediaStreamConstraints) => {
        const want = ((c.audio as MediaTrackConstraints).deviceId as { exact?: string } | undefined)?.exact;
        if (want && !DEVICES.some((d) => d.deviceId === want)) throw Object.assign(new Error('gone'), { name: 'OverconstrainedError' });
        return streamFor(want ?? browserPick);
      }),
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('a working microphone (11.3.2)', () => {
  it('a silent virtual input is swapped for one that carries sound, remembered, and named', async () => {
    const mic = await openMic();
    expect(mic.label).toBe('Default - MacBook Air Microphone (Built-in)');
    expect(mic.replaced).toBe('BlackHole 2ch (Virtual)');
    expect(stopped).toContain('blackhole');
    expect(localStorage.getItem(MIC_KEY)).toBe('default');
    // The next chat opens the remembered one straight away.
    const again = await openMic();
    expect(again.replaced).toBeUndefined();
    expect(again.label).toBe('Default - MacBook Air Microphone (Built-in)');
  });

  it('a microphone that carries sound is used as it is', async () => {
    browserPick = 'builtin';
    const mic = await openMic();
    expect(mic).toMatchObject({ label: 'MacBook Air Microphone (Built-in)' });
    expect(mic.replaced).toBeUndefined();
    expect(localStorage.getItem(MIC_KEY)).toBeNull();
  });

  it('every input silent: the first stays open and says so', async () => {
    SILENT.add('builtin').add('default');
    const mic = await openMic();
    expect(mic.allSilent).toBe(true);
    expect(mic.label).toBe('BlackHole 2ch (Virtual)');
    SILENT.delete('builtin');
    SILENT.delete('default');
  });

  it('a remembered microphone that was unplugged is forgotten', async () => {
    localStorage.setItem(MIC_KEY, 'usb-headset');
    browserPick = 'builtin';
    const mic = await openMic();
    expect(mic.label).toBe('MacBook Air Microphone (Built-in)');
    expect(localStorage.getItem(MIC_KEY)).toBeNull();
  });
});
