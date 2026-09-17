// @vitest-environment jsdom
/**
 * A native WebView with no speech voices installed accepts an utterance and
 * never reports `end` or `error` — without a guard the reply "speaks" forever
 * (and the DJ voice keeps the music ducked).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/native', () => ({ isNativePlatform: () => true }));
const { onSpeakingChange, readAloud, setReadAloudVoice, stopReadAloud } = await import('./readAloud');

class FakeUtterance {
  voice: unknown = null;
  rate = 1;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public text: string) {}
}

let voices: Array<{ lang: string; name: string }> = [];
const speak = vi.fn<(u: FakeUtterance) => void>();

beforeEach(() => {
  speak.mockClear();
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
  vi.stubGlobal('speechSynthesis', { cancel: () => undefined, speak, getVoices: () => voices });
  setReadAloudVoice(null);
});
afterEach(() => {
  stopReadAloud();
  vi.unstubAllGlobals();
});

describe('speakOnDevice on the native platform', () => {
  it('gives the turn back at once when no voices are installed', () => {
    voices = [];
    const seen: Array<string | null> = [];
    const off = onSpeakingChange((id) => seen.push(id));
    readAloud('r1', 'hello there');
    off();
    expect(speak).not.toHaveBeenCalled();
    expect(seen[seen.length - 1]).toBeNull();
    expect(seen).toContain('r1');
  });

  it('speaks normally when a voice exists', () => {
    voices = [{ lang: 'en-IN', name: 'Device' }];
    readAloud('r2', 'hello there');
    expect(speak).toHaveBeenCalledTimes(1);
  });
});
