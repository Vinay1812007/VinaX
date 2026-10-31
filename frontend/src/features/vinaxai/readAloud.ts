/**
 * VinaX AI — Read aloud: one reply at a time. Pressing the speaker on a
 * reply stops any other reading, asks the Worker to read this one, and plays
 * each piece as it arrives (gapless, one after another). Music plays on,
 * quietly, until the reading ends or is stopped.
 */
import { create } from 'zustand';
import { AiError, speakText, voiceNotice } from './api';
import { holdMusic } from './musicHold';
import { usePrefs } from './prefs';
import { FrameReader, toAudioBuffer } from './speechStream';
import { speechText } from './speechText';

interface ReadState {
  /** The reply being read, and whether its first sound has started. */
  messageId: string | null;
  phase: 'idle' | 'loading' | 'playing';
  /** A calm message when a reading failed (cleared by the next one). */
  notice: string | null;
}

export const useReadAloud = create<ReadState>()(() => ({ messageId: null, phase: 'idle', notice: null }));

let run = 0;
let ctx: AudioContext | null = null;
let abort: AbortController | null = null;
let release: (() => void) | null = null;
let endTimer = 0;

function teardown(): void {
  abort?.abort();
  abort = null;
  window.clearTimeout(endTimer);
  endTimer = 0;
  void ctx?.close().catch(() => undefined);
  ctx = null;
  release?.();
  release = null;
}

export function stopReading(): void {
  run += 1;
  teardown();
  useReadAloud.setState({ messageId: null, phase: 'idle' });
}

/** Start reading a reply (call inside the tap: the audio context needs it). */
export async function readAloud(messageId: string, reply: string): Promise<void> {
  stopReading();
  const text = speechText(reply);
  if (!text) return;
  const mine = (run += 1);
  const live = () => mine === run;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) {
    useReadAloud.setState({ notice: 'Read aloud isn’t supported in this browser.' });
    return;
  }
  ctx = new AC();
  const audio = ctx;
  void audio.resume().catch(() => undefined);
  abort = new AbortController();
  release = holdMusic('duck');
  useReadAloud.setState({ messageId, phase: 'loading', notice: null });
  const { voice, liveVoice } = usePrefs.getState();
  let nextAt = 0;
  let stoppedEarly: string | null = null;
  try {
    const res = await speakText(text, { voice, liveVoice }, abort.signal);
    const reader = res.body!.getReader();
    const frames = new FrameReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done || !live()) break;
      for (const f of frames.push(value)) {
        if (f.kind === 'stopped') { stoppedEarly = f.error; continue; }
        const buf = await toAudioBuffer(audio, f.mime, f.bytes);
        if (!live()) return;
        const src = audio.createBufferSource();
        src.buffer = buf;
        src.connect(audio.destination);
        nextAt = Math.max(nextAt, audio.currentTime + 0.05);
        src.start(nextAt);
        nextAt += buf.duration;
        if (useReadAloud.getState().phase !== 'playing') useReadAloud.setState({ phase: 'playing' });
      }
    }
  } catch (e) {
    if (!live()) return;
    const code = e instanceof AiError ? e.code : 'voice_unavailable';
    stopReading();
    useReadAloud.setState({ notice: voiceNotice(code) });
    return;
  }
  if (!live()) return;
  if (nextAt === 0) {
    stopReading();
    useReadAloud.setState({ notice: voiceNotice(stoppedEarly ?? 'voice_unavailable') });
    return;
  }
  // Finished receiving: end when the last piece has played.
  const left = Math.max(0, nextAt - audio.currentTime);
  endTimer = window.setTimeout(() => {
    if (!live()) return;
    stopReading();
    if (stoppedEarly) useReadAloud.setState({ notice: voiceNotice(stoppedEarly) });
  }, left * 1000 + 150);
}

export const dismissReadNotice = (): void => useReadAloud.setState({ notice: null });
