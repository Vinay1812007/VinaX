/**
 * VinaX AI — the microphone: a silent virtual device (BlackHole, a
 * remote-desktop driver…) is never used when a real mic exists, and the
 * meters use a loudness scale that moves for ordinary speech.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanMicLabel, hasSignal, isVirtualMic, loudness, openMic, pickRealMic, rmsOf, silentMicNotice, type MicDevice } from './mic';

vi.mock('@/features/voice/stt', () => ({ nativeMicPermission: async () => true }));

const dev = (deviceId: string, label: string): MicDevice => ({ deviceId, label, virtual: isVirtualMic(label) });

describe('which microphone', () => {
  it('knows virtual devices from real mics', () => {
    for (const v of ['BlackHole 2ch (Virtual)', 'RemotePCMic (Virtual)', 'Loopback Audio', 'VB-Audio Virtual Cable', 'CABLE Output (VB-Audio Virtual Cable)', 'ZoomAudioDevice', 'Microsoft Teams Audio', 'Default - BlackHole 2ch (Virtual)']) {
      expect(isVirtualMic(v), v).toBe(true);
    }
    for (const r of ['MacBook Air Microphone (Built-in)', 'realme Buds T110 (Bluetooth)', 'AirPods Pro', 'Krisp Microphone', 'Microphone Array (Realtek(R) Audio)', 'Default - realme Buds T110 (Bluetooth)']) {
      expect(isVirtualMic(r), r).toBe(false);
    }
  });

  it('picks the real system default first, then a built-in mic, never a virtual one', () => {
    const mics = [dev('bh', 'BlackHole 2ch (Virtual)'), dev('mac', 'MacBook Air Microphone (Built-in)'), dev('buds', 'realme Buds T110 (Bluetooth)'), dev('default', 'Default - realme Buds T110 (Bluetooth)')];
    expect(pickRealMic(mics, 'bh')?.deviceId).toBe('default');
    expect(pickRealMic(mics.slice(0, 3), 'bh')?.deviceId).toBe('mac');
    expect(pickRealMic([dev('default', 'Default - BlackHole 2ch (Virtual)'), dev('bh', 'BlackHole 2ch (Virtual)')], 'default')).toBeNull();
    expect(cleanMicLabel('Default - realme Buds T110 (Bluetooth)')).toBe('realme Buds T110 (Bluetooth)');
  });

  describe('openMic', () => {
    const original = navigator.mediaDevices;
    afterEach(() => Object.defineProperty(navigator, 'mediaDevices', { value: original, configurable: true }));

    const fakeStream = (label: string, deviceId: string) => {
      const track = { label, stop: vi.fn(), getSettings: () => ({ deviceId }) };
      return { getAudioTracks: () => [track], getTracks: () => [track], track } as unknown as MediaStream & { track: typeof track };
    };
    const install = (byId: Record<string, string>, browserDefault: string) => {
      const getUserMedia = vi.fn(async (c: { audio: { deviceId?: { exact: string } } }) => {
        const id = c.audio.deviceId?.exact ?? browserDefault;
        if (!(id in byId)) throw Object.assign(new Error('gone'), { name: 'OverconstrainedError' });
        return fakeStream(byId[id], id);
      });
      const enumerateDevices = vi.fn(async () => Object.entries(byId).map(([deviceId, label]) => ({ kind: 'audioinput', deviceId, label })));
      Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia, enumerateDevices }, configurable: true });
      return getUserMedia;
    };

    it('when the browser hands over a virtual device, a real mic is opened instead', async () => {
      const gum = install({ bh: 'BlackHole 2ch (Virtual)', mac: 'MacBook Air Microphone (Built-in)' }, 'bh');
      const s = await openMic('');
      expect(s.getAudioTracks()[0].label).toBe('MacBook Air Microphone (Built-in)');
      expect(gum).toHaveBeenCalledTimes(2);
    });

    it('a mic picked in Settings is used as it is, even a virtual one; an unplugged one falls back to the browser’s', async () => {
      install({ bh: 'BlackHole 2ch (Virtual)', mac: 'MacBook Air Microphone (Built-in)' }, 'mac');
      expect((await openMic('bh')).getAudioTracks()[0].label).toBe('BlackHole 2ch (Virtual)');
      expect((await openMic('usb-gone')).getAudioTracks()[0].label).toBe('MacBook Air Microphone (Built-in)');
    });

    it('a real browser mic is used straight away', async () => {
      const gum = install({ mac: 'MacBook Air Microphone (Built-in)' }, 'mac');
      await openMic('');
      expect(gum).toHaveBeenCalledTimes(1);
    });
  });
});

describe('levels', () => {
  it('ordinary speech fills most of the meter; a quiet room barely moves it', () => {
    expect(loudness(0)).toBe(0);
    expect(loudness(0.0002)).toBe(0); // Bluetooth headset, nobody talking
    expect(loudness(0.03)).toBeGreaterThan(0.5); // speaking
    expect(loudness(0.1)).toBeGreaterThan(0.75);
    expect(loudness(1)).toBe(1);
    expect(rmsOf(Float32Array.from([0.5, -0.5]))).toBeCloseTo(0.5);
  });

  it('pure digital silence is told apart from a quiet real mic', () => {
    expect(hasSignal(new Float32Array(512))).toBe(false);
    const quiet = new Float32Array(512);
    quiet[100] = 0.00003;
    expect(hasSignal(quiet)).toBe(true);
    expect(silentMicNotice('BlackHole 2ch (Virtual)')).toContain('“BlackHole 2ch (Virtual)”');
  });
});

describe('watchMic', () => {
  it('a suspended audio context proves nothing: the clip is not called silent', async () => {
    const { watchMic } = await import('./mic');
    const analyser = { fftSize: 0, getFloatTimeDomainData: (b: Float32Array) => b.fill(0), disconnect: vi.fn() };
    const ctx = { state: 'suspended', sampleRate: 48_000, resume: async () => undefined, createMediaStreamSource: () => ({ connect: vi.fn() }), createAnalyser: () => analyser } as unknown as AudioContext;
    const w = watchMic({} as MediaStream, ctx);
    for (let i = 0; i < 20; i += 1) w.level();
    expect(w.heard()).toBe(true);
    (ctx as { state: string }).state = 'running';
    for (let i = 0; i < 20; i += 1) w.level();
    expect(w.heard()).toBe(false); // running, and every sample exactly zero: the wrong mic
  });
});
