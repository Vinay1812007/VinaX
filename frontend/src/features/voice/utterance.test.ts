// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isPhantom, recordUtterance } from './utterance';

/** A recorder that hands over one chunk per `start` timeslice tick and one on stop. */
class FakeRecorder {
  static last: FakeRecorder | null = null;
  state: 'inactive' | 'recording' = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: ((e: Event) => void) | null = null;
  constructor() {
    FakeRecorder.last = this;
  }
  static isTypeSupported(t: string): boolean {
    return t === 'audio/webm;codecs=opus';
  }
  start(): void {
    this.state = 'recording';
  }
  stop(): void {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['opus-bytes'], { type: 'audio/webm' }) });
    this.onstop?.(new Event('stop'));
  }
}

let level = 0;
const stream = {} as MediaStream;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  level = 0.004;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Advance in 50 ms ticks so the detector sees every level. */
const run = async (ms: number): Promise<void> => {
  for (let t = 0; t < ms; t += 50) await vi.advanceTimersByTimeAsync(50);
};

describe('one spoken turn through the server (11.3.1)', () => {
  it('waits for speech, ends after the quiet that follows it, and sends the clip', async () => {
    const transcribe = vi.fn(async (clip: Blob) => (clip.size ? 'suggest five telugu songs' : null));
    const ev: string[] = [];
    const onEnd = vi.fn();
    recordUtterance(
      { stream, getLevel: () => level, transcribe, silenceMs: 900 },
      { onSpeechStart: () => ev.push('start'), onSpeechEnd: () => ev.push('end'), onEnd },
    );
    await run(1000); // the room
    expect(ev).toEqual([]);
    level = 0.08; // talking
    await run(1500);
    expect(ev).toEqual(['start']);
    level = 0.005; // stopped
    await run(600);
    expect(ev).toEqual(['start']); // a pause is not the end yet
    await run(500);
    expect(ev).toEqual(['start', 'end']);
    await vi.runAllTimersAsync();
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect((transcribe.mock.calls[0][0] as Blob).type).toBe('audio/webm');
    expect(onEnd).toHaveBeenCalledWith('suggest five telugu songs', false);
  });

  it('no speech: nothing is sent and the turn ends empty', async () => {
    const transcribe = vi.fn(async () => 'x');
    const onEnd = vi.fn();
    recordUtterance({ stream, getLevel: () => level, transcribe, noSpeechMs: 3000 }, { onEnd });
    await run(3200);
    expect(transcribe).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledWith('', false);
  });

  it('a transcriber failure is reported, and abort sends nothing and reports nothing', async () => {
    const onEnd = vi.fn();
    recordUtterance({ stream, getLevel: () => level, transcribe: async () => null, silenceMs: 300 }, { onEnd });
    level = 0.1;
    await run(400);
    level = 0.004;
    await run(400);
    await vi.runAllTimersAsync();
    expect(onEnd).toHaveBeenCalledWith('', true);

    const onEnd2 = vi.fn();
    const transcribe = vi.fn(async () => 'never');
    const s = recordUtterance({ stream, getLevel: () => level, transcribe }, { onEnd: onEnd2 });
    level = 0.1;
    await run(400);
    s?.abort();
    await run(2000);
    expect(transcribe).not.toHaveBeenCalled();
    expect(onEnd2).not.toHaveBeenCalled();
  });

  it('a tap (stop) sends what was said at once', async () => {
    const transcribe = vi.fn(async () => 'play something calm');
    const onEnd = vi.fn();
    const s = recordUtterance({ stream, getLevel: () => level, transcribe }, { onEnd });
    level = 0.1;
    await run(400);
    s?.stop();
    await vi.runAllTimersAsync();
    expect(onEnd).toHaveBeenCalledWith('play something calm', false);
  });

  it('drops the phrases speech-to-text invents from a breath, only when the speech was very short', () => {
    expect(isPhantom('Thank you.', 400)).toBe(true);
    expect(isPhantom('you', 300)).toBe(true);
    expect(isPhantom('Thank you.', 2500)).toBe(false);
    expect(isPhantom('Thank you for the songs', 400)).toBe(false);
  });
});
