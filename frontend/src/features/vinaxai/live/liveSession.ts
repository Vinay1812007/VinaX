/**
 * VinaX AI Live voice — one session: a one-use token from the Worker, a
 * WebSocket straight to Gemini Live (the key never reaches the page), the
 * mic streamed as 16 kHz PCM, and the voice played back as it arrives.
 * Talking over VinaX AI cuts it off (Gemini says "interrupted"); the
 * transcript is kept for the chat.
 *
 * When a model will not start (the socket closes before setupComplete), the
 * next Live model is asked for, at most three times.
 */
import { liveToken, type LiveTokenReply } from '../api';
import { closeMic, openMic } from '../mic';
import { base64ToBytes, pcm16 } from '../speechStream';
import { audioMessage, floatTo16, levelOf, OUTPUT_RATE, parseServerMessage, Resampler, streamEndMessage, Transcript, type LiveEvent } from './liveProtocol';
import tapUrl from './micTap.worklet.js?url';

export type LiveState = 'connecting' | 'listening' | 'speaking' | 'ended';
/** closed: the listener ended it · time: Gemini ended the session (its time limit) · dropped: the connection broke. */
export type LiveEndReason = 'closed' | 'time' | 'dropped' | 'failed' | 'mic';

export interface LiveCallbacks {
  onState(state: LiveState): void;
  onCaptions(now: { user: string; assistant: string }): void;
  onLevel(level: number, who: 'user' | 'assistant'): void;
  /** Fires once. `error` is a code for voiceNotice / micNotice when it failed. */
  onEnd(reason: LiveEndReason, error?: string): void;
}

const SETUP_TIMEOUT_MS = 12_000;
const MAX_ATTEMPTS = 3;

export class LiveSession {
  readonly transcript = new Transcript();
  model: { id: string; name: string } | null = null;
  private ws: WebSocket | null = null;
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private tap: AudioWorkletNode | null = null;
  private out: GainNode | null = null;
  private playing = new Set<AudioBufferSourceNode>();
  private nextAt = 0;
  private muted = false;
  private ready = false;
  private ended = false;
  private state: LiveState = 'connecting';

  constructor(private readonly opts: { thinking: boolean; voice: string }, private readonly cb: LiveCallbacks) {}

  /** Start (call inside the tap: the audio context and the mic need it). */
  async start(): Promise<void> {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC || typeof WebSocket === 'undefined') { this.finish('failed', 'unsupported'); return; }
    this.ctx = new AC();
    void this.ctx.resume().catch(() => undefined);
    this.out = this.ctx.createGain();
    this.out.connect(this.ctx.destination);
    this.setState('connecting');
    try {
      this.stream = await openMic();
    } catch (e) {
      this.finish('mic', (e as { problem?: string }).problem ?? 'unsupported');
      return;
    }
    if (this.ended) { closeMic(this.stream); return; }
    const skip: string[] = [];
    for (let attempt = 0; attempt < MAX_ATTEMPTS && !this.ended; attempt += 1) {
      let token: LiveTokenReply;
      try {
        token = await liveToken({ thinking: this.opts.thinking, skip, voice: this.opts.voice });
      } catch (e) {
        this.finish('failed', (e as { code?: string }).code ?? 'voice_unavailable');
        return;
      }
      if (this.ended) return;
      this.model = token.model;
      if (await this.connect(token)) break;
      skip.push(token.model.id);
      if (attempt === MAX_ATTEMPTS - 1) this.finish('failed', 'voice_unavailable');
    }
    if (this.ended || !this.ready) return;
    try {
      await this.startMic();
    } catch {
      this.finish('mic', 'unsupported');
    }
  }

  /** Open the socket and send the setup; true once Gemini says it is ready. */
  private connect(token: LiveTokenReply): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      const settle = (ok: boolean) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(ok);
      };
      const ws = new WebSocket(`${token.url}?access_token=${encodeURIComponent(token.token)}`);
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      const timer = window.setTimeout(() => { settle(false); try { ws.close(); } catch { /* closed */ } }, SETUP_TIMEOUT_MS);
      ws.onopen = () => ws.send(JSON.stringify({ setup: token.setup }));
      ws.onmessage = (e) => {
        const raw = typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data as ArrayBuffer);
        for (const ev of parseServerMessage(raw)) {
          if (ev.type === 'ready') { this.ready = true; settle(true); }
          this.handle(ev);
        }
      };
      ws.onclose = () => {
        if (!settled) { settle(false); return; }
        if (this.ws === ws) this.finish('dropped');
      };
      ws.onerror = () => { /* onclose follows */ };
    });
  }

  private async startMic(): Promise<void> {
    const ctx = this.ctx!;
    await ctx.audioWorklet.addModule(tapUrl);
    if (this.ended) return;
    const source = ctx.createMediaStreamSource(this.stream!);
    this.tap = new AudioWorkletNode(ctx, 'vinax-mic-tap');
    const resampler = new Resampler(ctx.sampleRate);
    this.tap.port.onmessage = (e: MessageEvent<Float32Array>) => {
      if (this.ended || this.muted || this.ws?.readyState !== WebSocket.OPEN) return;
      const samples = resampler.push(e.data);
      this.cb.onLevel(levelOf(samples), 'user');
      this.ws.send(audioMessage(floatTo16(samples)));
    };
    // The tap must be pulled to run; a silent gain keeps it out of the speakers.
    const silent = ctx.createGain();
    silent.gain.value = 0;
    source.connect(this.tap).connect(silent).connect(ctx.destination);
    this.setState('listening');
  }

  private handle(ev: LiveEvent): void {
    switch (ev.type) {
      case 'audio': this.play(ev.data); break;
      case 'heard': this.transcript.heard(ev.text); this.cb.onCaptions(this.transcript.now()); break;
      case 'said': this.transcript.said(ev.text); this.cb.onCaptions(this.transcript.now()); break;
      case 'interrupted': this.silence(); break;
      case 'turnComplete': this.transcript.complete(); break;
      case 'goAway': this.finish('time'); break;
      default: break;
    }
  }

  private play(b64: string): void {
    const ctx = this.ctx;
    if (!ctx || !this.out) return;
    const pcm = pcm16(base64ToBytes(b64), OUTPUT_RATE);
    if (!pcm.samples.length) return;
    const buf = ctx.createBuffer(1, pcm.samples.length, OUTPUT_RATE);
    buf.getChannelData(0).set(pcm.samples);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.out);
    this.nextAt = Math.max(this.nextAt, ctx.currentTime + 0.04);
    src.start(this.nextAt);
    this.nextAt += buf.duration;
    this.playing.add(src);
    this.cb.onLevel(levelOf(pcm.samples), 'assistant');
    this.setState('speaking');
    src.onended = () => {
      this.playing.delete(src);
      if (!this.playing.size && !this.ended) this.setState('listening');
    };
  }

  /** The listener talked over VinaX AI: stop its voice now. */
  private silence(): void {
    for (const s of this.playing) { try { s.stop(); } catch { /* already stopped */ } }
    this.playing.clear();
    this.nextAt = 0;
    if (!this.ended) this.setState('listening');
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted && this.ws?.readyState === WebSocket.OPEN) this.ws.send(streamEndMessage());
  }

  /** End the session (the listener closed it). */
  stop(): void {
    this.finish('closed');
  }

  private setState(s: LiveState): void {
    if (this.state === s || this.ended) return;
    this.state = s;
    this.cb.onState(s);
  }

  private finish(reason: LiveEndReason, error?: string): void {
    if (this.ended) return;
    this.ended = true;
    this.state = 'ended';
    this.silence();
    try { this.tap?.disconnect(); } catch { /* gone */ }
    closeMic(this.stream);
    this.stream = null;
    const ws = this.ws;
    this.ws = null;
    try { ws?.close(1000); } catch { /* closed */ }
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.cb.onState('ended');
    this.cb.onEnd(reason, error);
  }
}
