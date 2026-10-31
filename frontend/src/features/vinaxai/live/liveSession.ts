/**
 * VinaX AI Live voice — one session: a one-use token from the Worker, a
 * WebSocket straight to Gemini Live (the key never reaches the page), the
 * mic streamed as 16 kHz PCM, and the voice played back as it arrives.
 * Talking over VinaX AI cuts it off (Gemini says "interrupted"); the
 * transcript is kept for the chat.
 *
 * When a model will not start (the socket closes before setupComplete), the
 * next Live model is asked for, at most three times.
 *
 * The orb follows the real audio: an analyser on the mic and one on the
 * voice, read every frame, on a loudness scale (mic.ts). When the mic gives
 * pure silence for a few seconds, the view says so and offers other mics;
 * `switchMic` swaps the mic without ending the session.
 */
import { liveToken, type LiveTokenReply } from '../api';
import { closeMic, hasSignal, loudness, micLabelOf, micSource, newAudioContext, openMic, rmsOf } from '../mic';
import { base64ToBytes, pcm16 } from '../speechStream';
import { audioMessage, floatTo16, OUTPUT_RATE, parseServerMessage, Resampler, streamEndMessage, Transcript, type LiveEvent } from './liveProtocol';
import tapUrl from './micTap.worklet.js?url';

export type LiveState = 'connecting' | 'listening' | 'speaking' | 'ended';
/** closed: the listener ended it · time: Gemini ended the session (its time limit) · dropped: the connection broke. */
export type LiveEndReason = 'closed' | 'time' | 'dropped' | 'failed' | 'mic';

export interface LiveCallbacks {
  onState(state: LiveState): void;
  onCaptions(now: { user: string; assistant: string }): void;
  onLevel(level: number, who: 'user' | 'assistant'): void;
  /** The mic in use, and whether it has given only silence so far (a muted or virtual device). */
  onMic?(mic: { label: string; silent: boolean }): void;
  /** Fires once. `error` is a code for voiceNotice / micNotice when it failed. */
  onEnd(reason: LiveEndReason, error?: string): void;
}

const SETUP_TIMEOUT_MS = 12_000;
const MAX_ATTEMPTS = 3;
/** Pure silence from the mic for this long, while listening, means it is the wrong mic. */
const SILENT_AFTER_MS = 2_500;

export class LiveSession {
  readonly transcript = new Transcript();
  model: { id: string; name: string } | null = null;
  private ws: WebSocket | null = null;
  private ctx: AudioContext | null = null;
  /** The mic's context: the same as `ctx`, unless the browser needed one at the mic's own rate. */
  private inCtx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private tap: AudioWorkletNode | null = null;
  private out: GainNode | null = null;
  private micMeter: AnalyserNode | null = null;
  private outMeter: AnalyserNode | null = null;
  private frame = 0;
  private heard = false;
  private listenSince = 0;
  private silentShown = false;
  private playing = new Set<AudioBufferSourceNode>();
  private nextAt = 0;
  private muted = false;
  private ready = false;
  private ended = false;
  private state: LiveState = 'connecting';

  constructor(private readonly opts: { thinking: boolean; voice: string; model?: string; micId?: string }, private readonly cb: LiveCallbacks) {}

  /** The mic in use now. */
  get micLabel(): string {
    return micLabelOf(this.stream);
  }

  /** Start (call inside the tap: the audio context and the mic need it). */
  async start(): Promise<void> {
    this.ctx = typeof WebSocket === 'undefined' ? null : newAudioContext();
    if (!this.ctx) { this.finish('failed', 'unsupported'); return; }
    this.out = this.ctx.createGain();
    this.out.connect(this.ctx.destination);
    this.outMeter = this.ctx.createAnalyser();
    this.outMeter.fftSize = 1024;
    this.out.connect(this.outMeter);
    this.setState('connecting');
    try {
      this.stream = await openMic(this.opts.micId ?? '');
    } catch (e) {
      this.finish('mic', (e as { problem?: string }).problem ?? 'unsupported');
      return;
    }
    if (this.ended) { closeMic(this.stream); return; }
    const skip: string[] = [];
    for (let attempt = 0; attempt < MAX_ATTEMPTS && !this.ended; attempt += 1) {
      let token: LiveTokenReply;
      try {
        token = await liveToken({ thinking: this.opts.thinking, skip, voice: this.opts.voice, ...(this.opts.model && this.opts.model !== 'auto' ? { model: this.opts.model } : {}) });
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
    const { ctx: inCtx, source } = micSource(this.ctx!, this.stream!);
    this.inCtx = inCtx;
    void inCtx.resume().catch(() => undefined);
    await inCtx.audioWorklet.addModule(tapUrl);
    if (this.ended) return;
    this.source = source;
    this.tap = new AudioWorkletNode(inCtx, 'vinax-mic-tap');
    const resampler = new Resampler(inCtx.sampleRate);
    this.tap.port.onmessage = (e: MessageEvent<Float32Array>) => {
      if (this.ended || this.muted || this.ws?.readyState !== WebSocket.OPEN) return;
      this.ws.send(audioMessage(floatTo16(resampler.push(e.data))));
    };
    this.micMeter = inCtx.createAnalyser();
    this.micMeter.fftSize = 1024;
    // The tap must be pulled to run; a silent gain keeps it out of the speakers.
    const silent = inCtx.createGain();
    silent.gain.value = 0;
    this.tap.connect(silent).connect(inCtx.destination);
    this.plugMic(source);
    this.setState('listening');
    this.cb.onMic?.({ label: this.micLabel, silent: false });
    this.meterLoop();
  }

  private plugMic(source: MediaStreamAudioSourceNode): void {
    source.connect(this.tap!);
    source.connect(this.micMeter!);
    this.heard = false;
    this.silentShown = false;
    this.listenSince = performance.now();
  }

  /** Use another mic without ending the session. */
  async switchMic(deviceId: string): Promise<void> {
    if (this.ended || !this.inCtx || !this.tap) return;
    const stream = await openMic(deviceId);
    if (this.ended) { closeMic(stream); return; }
    let source: MediaStreamAudioSourceNode;
    try {
      source = this.inCtx.createMediaStreamSource(stream);
    } catch {
      closeMic(stream);
      throw new Error('mic_rate');
    }
    try { this.source?.disconnect(); } catch { /* gone */ }
    closeMic(this.stream);
    this.stream = stream;
    this.source = source;
    this.plugMic(source);
    this.cb.onMic?.({ label: this.micLabel, silent: false });
  }

  /** Every frame: the orb's level from the real audio, and the silent-mic check. */
  private meterLoop(): void {
    const buf = new Float32Array(1024);
    let smooth = 0;
    const read = (a: AnalyserNode | null): number => {
      if (!a) return 0;
      a.getFloatTimeDomainData(buf);
      return loudness(rmsOf(buf));
    };
    const step = () => {
      if (this.ended) return;
      let mic = 0;
      if (this.micMeter && !this.muted) {
        this.micMeter.getFloatTimeDomainData(buf);
        if (!this.heard && hasSignal(buf)) {
          this.heard = true;
          if (this.silentShown) this.cb.onMic?.({ label: this.micLabel, silent: false });
        }
        mic = loudness(rmsOf(buf));
      }
      const voice = read(this.outMeter);
      const now = Math.max(mic, voice);
      smooth = now > smooth ? now : smooth * 0.8 + now * 0.2;
      this.cb.onLevel(smooth, voice > mic ? 'assistant' : 'user');
      if (this.inCtx?.state !== 'running') this.listenSince = performance.now();
      if (!this.heard && !this.muted && !this.silentShown && performance.now() - this.listenSince > SILENT_AFTER_MS) {
        this.silentShown = true;
        this.cb.onMic?.({ label: this.micLabel, silent: true });
      }
      this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
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
    // Silence while muted proves nothing about the mic.
    if (!muted) this.listenSince = performance.now();
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
    cancelAnimationFrame(this.frame);
    this.cb.onLevel(0, 'user');
    try { this.tap?.disconnect(); } catch { /* gone */ }
    try { this.source?.disconnect(); } catch { /* gone */ }
    closeMic(this.stream);
    this.stream = null;
    const ws = this.ws;
    this.ws = null;
    try { ws?.close(1000); } catch { /* closed */ }
    if (this.inCtx && this.inCtx !== this.ctx) void this.inCtx.close().catch(() => undefined);
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.inCtx = null;
    this.cb.onState('ended');
    this.cb.onEnd(reason, error);
  }
}
