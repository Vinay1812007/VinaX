// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatClock, recorderSupported, useServerDictation } from './useServerDictation';
import { ranCode } from './Message';

/** A recorder that hands back one small chunk when stopped. */
class FakeRecorder {
  static isTypeSupported = (t: string): boolean => t === 'audio/webm;codecs=opus';
  state: 'inactive' | 'recording' = 'inactive';
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(_s: unknown, opts?: { mimeType?: string }) {
    this.mimeType = opts?.mimeType ?? '';
  }
  start(): void {
    this.state = 'recording';
  }
  stop(): void {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' }) });
    this.onstop?.();
  }
}

const PICK = { provider: 'groq' as const, model: 'ears-1', name: 'Ears One' };
const stopTrack = vi.fn();

beforeEach(() => {
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] })) },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  stopTrack.mockClear();
});

describe('server dictation (10.3)', () => {
  it('records, posts the recording and hands back the text', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ text: 'play something calm' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const onText = vi.fn();
    const onFallback = vi.fn();
    const { result } = renderHook(() => useServerDictation({ pick: PICK, onText, onFallback }));
    expect(recorderSupported()).toBe(true);
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state).toBe('recording'));
    // Wait for the recorder to exist (getUserMedia resolves first).
    await act(async () => {
      await Promise.resolve();
    });
    act(() => result.current.stop());
    await waitFor(() => expect(onText).toHaveBeenCalledWith('play something calm'));
    expect(onFallback).not.toHaveBeenCalled();
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string) as Record<string, string>;
    expect(body).toMatchObject({ mime: 'audio/webm', provider: 'groq', model: 'ears-1' });
    expect(stopTrack).toHaveBeenCalled();
    expect(result.current.state).toBe('idle');
  });

  it('falls back to the device when the model fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'unknown_model' }), { status: 400 })));
    const onText = vi.fn();
    const onFallback = vi.fn();
    const { result } = renderHook(() => useServerDictation({ pick: PICK, onText, onFallback }));
    act(() => result.current.start());
    await act(async () => {
      await Promise.resolve();
    });
    act(() => result.current.stop());
    await waitFor(() => expect(onFallback).toHaveBeenCalledWith('failed'));
    expect(onText).not.toHaveBeenCalled();
  });

  it('falls back when the mic is refused, or when the browser cannot record', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => Promise.reject(Object.assign(new Error('no'), { name: 'NotAllowedError' }))) },
    });
    const onFallback = vi.fn();
    const { result } = renderHook(() => useServerDictation({ pick: PICK, onText: vi.fn(), onFallback }));
    act(() => result.current.start());
    await waitFor(() => expect(onFallback).toHaveBeenCalledWith('denied'));

    vi.stubGlobal('MediaRecorder', undefined);
    const onFallback2 = vi.fn();
    const r2 = renderHook(() => useServerDictation({ pick: PICK, onText: vi.fn(), onFallback: onFallback2 }));
    act(() => r2.result.current.start());
    expect(onFallback2).toHaveBeenCalledWith('unsupported');
  });

  it('a cancelled recording sends nothing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const onFallback = vi.fn();
    const { result } = renderHook(() => useServerDictation({ pick: PICK, onText: vi.fn(), onFallback }));
    act(() => result.current.start());
    await act(async () => {
      await Promise.resolve();
    });
    act(() => result.current.cancel());
    await waitFor(() => expect(result.current.state).toBe('idle'));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onFallback).not.toHaveBeenCalled();
  });

  /** A microphone that opens only when the test says so. */
  const slowMic = (): { open: () => Promise<void>; calls: () => number } => {
    const waiting: Array<(s: unknown) => void> = [];
    const getUserMedia = vi.fn(() => new Promise((resolve) => waiting.push(resolve)));
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    return {
      open: async () => {
        await act(async () => {
          waiting.splice(0).forEach((resolve) => resolve({ getTracks: () => [{ stop: stopTrack }] }));
          await Promise.resolve();
        });
      },
      calls: () => getUserMedia.mock.calls.length,
    };
  };

  it('11.0 — Stop while the microphone is still opening ends it, and the mic is released when it arrives', async () => {
    const mic = slowMic();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const onText = vi.fn();
    const onFallback = vi.fn();
    const { result } = renderHook(() => useServerDictation({ pick: PICK, onText, onFallback }));
    act(() => result.current.start());
    // Not "recording" yet: nothing is being captured until the mic arrives.
    expect(result.current.state).toBe('starting');
    act(() => result.current.stop());
    expect(result.current.state).toBe('idle');
    await mic.open();
    expect(stopTrack).toHaveBeenCalledTimes(1);
    expect(result.current.state).toBe('idle');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onText).not.toHaveBeenCalled();
    expect(onFallback).not.toHaveBeenCalled();
  });

  it('11.0 — a second start while the microphone is opening is ignored, and a cancelled start never leaves a mic open', async () => {
    const mic = slowMic();
    vi.stubGlobal('fetch', vi.fn());
    const { result } = renderHook(() => useServerDictation({ pick: PICK, onText: vi.fn(), onFallback: vi.fn() }));
    act(() => result.current.start());
    act(() => result.current.start());
    expect(mic.calls()).toBe(1);
    // Cancel, then start again before the first microphone has arrived: the
    // first stream must be let go, only the second one records.
    act(() => result.current.cancel());
    expect(result.current.state).toBe('idle');
    act(() => result.current.start());
    expect(mic.calls()).toBe(2);
    await mic.open();
    expect(stopTrack).toHaveBeenCalledTimes(1);
    expect(result.current.state).toBe('recording');
    act(() => result.current.cancel());
    await waitFor(() => expect(result.current.state).toBe('idle'));
    expect(stopTrack).toHaveBeenCalledTimes(2);
  });

  it('shows the timer as m:ss', () => {
    expect(formatClock(7_400)).toBe('0:07');
    expect(formatClock(60_000)).toBe('1:00');
  });
});

describe('Ran code marker (10.3)', () => {
  it('shows only when the code tool was on AND the reply holds a code block', () => {
    expect(ranCode({ tools: ['code_execution'], content: 'Result:\n```python\nprint(2+2)\n```\n```\n4\n```' })).toBe(true);
    expect(ranCode({ tools: ['code_execution'], content: 'Four.' })).toBe(false);
    expect(ranCode({ content: '```js\n1\n```' })).toBe(false);
  });
});
