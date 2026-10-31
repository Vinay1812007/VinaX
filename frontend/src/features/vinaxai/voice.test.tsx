// @vitest-environment jsdom
/**
 * VinaX AI voice on the page: what Read aloud says, the speech stream's
 * frames and audio, Live's resampling, messages and transcript, music
 * stepping aside, and the composer's mic and Live buttons.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MAX_SPEAK_CHARS, speechText } from './speechText';
import { base64ToBytes, FrameReader, parseWav, pcm16 } from './speechStream';
import { bytesToBase64, floatTo16, INPUT_MIME, parseServerMessage, Resampler, Transcript, audioMessage } from './live/liveProtocol';
import { Composer } from './Composer';
import type { Dictation } from './useVoiceDictation';

afterEach(cleanup);

describe('speechText: a reply as words to say', () => {
  it('drops code, citations, link addresses and markup, keeps the words', () => {
    const md = [
      '# Ragas',
      'A **raga** is a _melodic_ framework [1][2]. See [the guide](https://example.com/guide) or https://www.wikipedia.org/wiki/Raga.',
      '',
      '```python',
      'print("not read")',
      '```',
      '- First point',
      '2. Second point',
      '> A quote',
      '| Name | Time |',
      '|------|------|',
      '| Yaman | Evening |',
      'Inline `code` and ~~gone~~ text, $x^2$.',
    ].join('\n');
    const out = speechText(md);
    expect(out).toContain('Ragas.');
    expect(out).toContain('A raga is a melodic framework.');
    expect(out).toContain('See the guide or wikipedia.org.');
    expect(out).toContain('There’s a code block here.');
    expect(out).not.toContain('not read');
    expect(out).toContain('First point');
    expect(out).toContain('Second point');
    expect(out).toContain('A quote');
    expect(out).toContain('Yaman, Evening.');
    expect(out).not.toMatch(/[*_`#|~]|\[\d\]|https?:/);
  });

  it('an artifact is named, not read', () => {
    const out = speechText('Here it is.\n<artifact id="p" type="html" title="Hello page"><h1>Hi</h1></artifact>\nDone.');
    expect(out).toBe('Here it is.\n\n(Hello page is open in the side panel.)\n\nDone.');
  });

  it('a very long reply is cut at a sentence end', () => {
    const out = speechText('This is one sentence. '.repeat(600));
    expect(out.length).toBeLessThanOrEqual(MAX_SPEAK_CHARS);
    expect(out.endsWith('.')).toBe(true);
  });
});

/** A frame as the Worker writes it. */
function frame(kind: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(5 + payload.length);
  out[0] = kind;
  new DataView(out.buffer).setUint32(1, payload.length);
  out.set(payload, 5);
  return out;
}
const enc = new TextEncoder();
function wav(samples: number[], rate = 24_000, dataSize?: number): Uint8Array {
  const data = new Uint8Array(samples.length * 2);
  const dv = new DataView(data.buffer);
  samples.forEach((s, i) => dv.setInt16(i * 2, s, true));
  const head = new Uint8Array(44);
  const h = new DataView(head.buffer);
  head.set(enc.encode('RIFF'), 0); h.setUint32(4, 36 + data.length, true); head.set(enc.encode('WAVE'), 8);
  head.set(enc.encode('fmt '), 12); h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, 1, true);
  h.setUint32(24, rate, true); h.setUint32(28, rate * 2, true); h.setUint16(32, 2, true); h.setUint16(34, 16, true);
  head.set(enc.encode('data'), 36); h.setUint32(40, dataSize ?? data.length, true);
  const out = new Uint8Array(44 + data.length);
  out.set(head);
  out.set(data, 44);
  return out;
}

describe('the speech stream', () => {
  it('reads frames that arrive in pieces, of each kind', () => {
    const file = frame(1, new Uint8Array([...enc.encode('audio/wav\n'), 1, 2, 3]));
    const b64 = frame(2, enc.encode(`audio/L16;rate=24000\n${btoa('\x01\x02')}`));
    const stop = frame(3, enc.encode('{"error":"voice_busy"}'));
    const all = new Uint8Array([...file, ...b64, ...stop]);
    const r = new FrameReader();
    const got = [...r.push(all.slice(0, 4)), ...r.push(all.slice(4, 20)), ...r.push(all.slice(20))];
    expect(got).toEqual([
      { kind: 'audio', mime: 'audio/wav', bytes: new Uint8Array([1, 2, 3]) },
      { kind: 'audio', mime: 'audio/L16;rate=24000', bytes: new Uint8Array([1, 2]) },
      { kind: 'stopped', error: 'voice_busy' },
    ]);
  });

  it('reads 16-bit WAV by hand, including a streamed header that does not know its length', () => {
    const pcm = parseWav(wav([0, 16384, -32768], 24_000))!;
    expect(pcm.rate).toBe(24_000);
    expect([...pcm.samples]).toEqual([0, 0.5, -1]);
    expect(parseWav(wav([100, 200], 16_000, 0xffffffff))!.samples).toHaveLength(2);
    expect(parseWav(enc.encode('ID3 not a wav'))).toBeNull();
  });

  it('turns raw PCM into floats', () => {
    expect([...pcm16(new Uint8Array([0, 0x40, 0, 0xc0]), 24_000).samples]).toEqual([0.5, -0.5]);
    expect([...base64ToBytes('AAEC')]).toEqual([0, 1, 2]);
  });
});

describe('Live voice protocol', () => {
  it('resamples 48 kHz to 16 kHz across batches without gaps', () => {
    const r = new Resampler(48_000);
    const ramp = Float32Array.from({ length: 4800 }, (_, i) => i / 4800);
    const a = r.push(ramp.slice(0, 2400));
    const b = r.push(ramp.slice(2400));
    expect(a.length + b.length).toBeGreaterThanOrEqual(1599);
    expect(a.length + b.length).toBeLessThanOrEqual(1600);
    const all = [...a, ...b];
    // Evenly spaced along the ramp: each step is 3 input samples.
    for (let i = 1; i < all.length; i += 1) expect(all[i] - all[i - 1]).toBeCloseTo(3 / 4800, 5);
  });

  it('packs mic audio as little-endian 16-bit PCM in a realtimeInput message', () => {
    expect([...floatTo16(Float32Array.from([0, 1, -1, 2]))]).toEqual([0, 0, 0xff, 0x7f, 0, 0x80, 0xff, 0x7f]);
    const msg = JSON.parse(audioMessage(new Uint8Array([1, 2, 3])));
    expect(msg).toEqual({ realtimeInput: { audio: { data: bytesToBase64(new Uint8Array([1, 2, 3])), mimeType: INPUT_MIME } } });
    expect(INPUT_MIME).toBe('audio/pcm;rate=16000');
  });

  it('reads the server messages it needs and ignores the rest', () => {
    expect(parseServerMessage('{"setupComplete":{}}')).toEqual([{ type: 'ready' }]);
    expect(parseServerMessage(JSON.stringify({ serverContent: { inputTranscription: { text: 'hi' }, modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm', data: 'AAA=' } }, { text: 'x' }] }, outputTranscription: { text: 'Hello' } } })))
      .toEqual([{ type: 'heard', text: 'hi' }, { type: 'audio', data: 'AAA=' }, { type: 'said', text: 'Hello' }]);
    expect(parseServerMessage('{"serverContent":{"interrupted":true}}')).toEqual([{ type: 'interrupted' }]);
    expect(parseServerMessage('{"serverContent":{"turnComplete":true}}')).toEqual([{ type: 'turnComplete' }]);
    expect(parseServerMessage('{"goAway":{"timeLeft":"10s"}}')).toEqual([{ type: 'goAway' }]);
    expect(parseServerMessage('{"usageMetadata":{}}')).toEqual([]);
    expect(parseServerMessage('not json')).toEqual([]);
  });

  it('builds the transcript exchange by exchange, even when the listener’s words arrive late', () => {
    const t = new Transcript();
    t.heard('What is ');
    t.said('A raga ');
    t.heard('a raga?');
    t.said('is a melody.');
    expect(t.now()).toEqual({ user: 'What is a raga?', assistant: 'A raga is a melody.' });
    t.complete();
    expect(t.now()).toEqual({ user: '', assistant: '' });
    t.heard('Thanks');
    t.complete();
    expect(t.turns()).toEqual([
      { role: 'user', text: 'What is a raga?' },
      { role: 'assistant', text: 'A raga is a melody.' },
      { role: 'user', text: 'Thanks' },
    ]);
  });
});

describe('music steps aside', () => {
  beforeEach(() => vi.resetModules());

  it('a mic hold pauses music and resumes it on release; a duck lowers the volume and restores it', async () => {
    const toggle = vi.fn();
    const setVolume = vi.fn();
    const state = { isPlaying: true, queue: [{ id: 's1' }], index: 0, volume: 0.8, togglePlay: toggle };
    toggle.mockImplementation(() => { state.isPlaying = !state.isPlaying; });
    vi.doMock('@/store/playerStore', () => ({ usePlayerStore: { getState: () => state } }));
    vi.doMock('@/services/audio/engine', () => ({ audioEngine: { setVolume } }));
    vi.doMock('@/services/cast', () => ({ useCastStore: { getState: () => ({ connected: false }) } }));
    const { holdMusic, DUCK_LEVEL } = await import('./musicHold');

    const releaseMic = holdMusic('pause');
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(state.isPlaying).toBe(false);
    const releaseMic2 = holdMusic('pause');
    releaseMic();
    expect(state.isPlaying).toBe(false); // still held
    releaseMic2();
    expect(state.isPlaying).toBe(true);

    const releaseDuck = holdMusic('duck');
    expect(setVolume).toHaveBeenLastCalledWith(0.8 * DUCK_LEVEL);
    releaseDuck();
    expect(setVolume).toHaveBeenLastCalledWith(0.8);
    releaseDuck(); // twice is harmless
    expect(setVolume).toHaveBeenCalledTimes(2);
  });

  it('music the listener paused (or changed) during a hold is not restarted', async () => {
    const toggle = vi.fn();
    const state = { isPlaying: true, queue: [{ id: 's1' }], index: 0, volume: 1, togglePlay: toggle };
    toggle.mockImplementation(() => { state.isPlaying = !state.isPlaying; });
    vi.doMock('@/store/playerStore', () => ({ usePlayerStore: { getState: () => state } }));
    vi.doMock('@/services/audio/engine', () => ({ audioEngine: { setVolume: vi.fn() } }));
    vi.doMock('@/services/cast', () => ({ useCastStore: { getState: () => ({ connected: false }) } }));
    const { holdMusic } = await import('./musicHold');
    const release = holdMusic('pause');
    state.queue = [{ id: 's2' }]; // another song was chosen meanwhile
    release();
    expect(toggle).toHaveBeenCalledTimes(1);
    const nothingPlaying = { ...state, isPlaying: false };
    Object.assign(state, nothingPlaying);
    holdMusic('pause')();
    expect(toggle).toHaveBeenCalledTimes(1);
  });
});

describe('<Composer /> voice', () => {
  const dictation = (over: Partial<Dictation> = {}): Dictation => ({
    phase: 'idle', seconds: 0, level: 0, silent: false, notice: null, noticeIsMic: false, supported: true,
    start: vi.fn(), finish: vi.fn(), cancel: vi.fn(), dismiss: vi.fn(), ...over,
  });
  const props = { onChange: vi.fn(), onSend: vi.fn(), onStop: vi.fn(), streaming: false };

  it('with nothing typed, Live voice stands where Send goes; typing brings Send back', () => {
    const onLive = vi.fn();
    const { rerender } = render(<Composer {...props} value="" onLive={onLive} dictation={dictation()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start Live voice' }));
    expect(onLive).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Send message' })).toBeNull();
    rerender(<Composer {...props} value="Hi" onLive={onLive} dictation={dictation()} />);
    expect(screen.getByRole('button', { name: 'Send message' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Start Live voice' })).toBeNull();
  });

  it('without Live voice the empty composer keeps a disabled Send', () => {
    render(<Composer {...props} value="" />);
    expect(screen.getByRole('button', { name: 'Send message' })).toHaveProperty('disabled', true);
    expect(screen.queryByRole('button', { name: 'Dictate' })).toBeNull();
  });

  it('the mic starts dictation; while recording, the bar offers Cancel and Finish', () => {
    const d = dictation();
    const { rerender } = render(<Composer {...props} value="" dictation={d} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dictate' }));
    expect(d.start).toHaveBeenCalled();
    const rec = dictation({ phase: 'recording', seconds: 65, level: 0.5 });
    rerender(<Composer {...props} value="" dictation={rec} />);
    expect(screen.getByText('1:05')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Finish dictation' }));
    expect(rec.finish).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel dictation' }));
    expect(rec.cancel).toHaveBeenCalled();
    rerender(<Composer {...props} value="" dictation={dictation({ phase: 'transcribing' })} />);
    expect(screen.getByRole('status').textContent).toContain('Transcribing');
  });

  it('a mic that gives only silence says so in place of the meter', () => {
    render(<Composer {...props} value="" dictation={dictation({ phase: 'recording', seconds: 3, silent: true })} />);
    expect(screen.getByText('No sound from your mic').getAttribute('role')).toBe('status');
  });

  it('no mic while a reply is written', () => {
    render(<Composer {...props} value="" streaming dictation={dictation()} onLive={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Dictate' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start Live voice' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
  });
});
