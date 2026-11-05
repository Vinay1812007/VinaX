/**
 * VinaX AI Live voice — one session: a one-use token from the Worker, a
 * WebSocket straight to Gemini Live (the key never reaches the page), the
 * mic streamed as 16 kHz PCM, and the voice played back as it arrives.
 * Talking over VinaX AI cuts it off (Gemini says "interrupted"); the
 * transcript is kept for the chat.
 *
 * Speed: the token and the socket are fetched while the mic opens (not
 * after), and the setup asks for a quick end of turn and quick thinking
 * (voice.ts). A model that refuses that setup (an invalid-argument close) is
 * asked again without it before the next model is tried.
 *
 * When a model will not start (the socket closes before setupComplete), the
 * next Live model is asked for, at most four times. With web search on,
 * the next model keeps search (some Live models refuse the search tool on
 * VinaX's key); only the last try goes without it, so search is never
 * dropped while a model that can search is left.
 *
 * Web search, the model, the voice and the language are part of the setup,
 * so switching one during a session reconnects: same mic, same transcript,
 * and the new session is told what was said so far. A switch made while it
 * is still connecting is applied once it is ready.
 *
 * `interrupt` (tapping the orb) cuts VinaX AI off without saying anything:
 * its voice stops and the rest of that reply is dropped.
 *
 * The orb follows the real audio: an analyser on the mic and one on the
 * voice, read every frame, on a loudness scale (mic.ts). When the mic gives
 * pure silence for a few seconds, the view says so and offers other mics;
 * `switchMic` swaps the mic without ending the session.
 *
 * In the Android app (docs/ai.md, "Live voice in the Android app"): opening
 * the mic puts the WebView in call mode, so the voice plays as call audio
 * (the phone's echo canceller then hears it) and Android sends it to the
 * earpiece. An APK with the VinaxAudioRoute plugin moves it to the
 * loudspeaker (`setSpeaker` switches back); the voice's audio context is made
 * after the mic there, so it is call audio from the start. Everywhere the
 * echo canceller may miss the voice, `EchoGuard` keeps it out of what is sent.
 * A dropped connection reconnects (twice at most) with what was said so far,
 * and the audio is resumed when the app comes back to the front.
 */
import { liveToken, type LiveTokenOptions, type LiveTokenReply } from '../api';
import { closeMic, hasSignal, loudness, micLabelOf, micSource, newAudioContext, openMic, rmsOf } from '../mic';
import { base64ToBytes, pcm16 } from '../speechStream';
import { isNativePlatform } from '@/services/native';
import { audioMessage, EchoGuard, floatTo16, OUTPUT_RATE, parseServerMessage, Resampler, streamEndMessage, Transcript, type LiveEvent } from './liveProtocol';
import { audioRouteAvailable, setSpeaker, startAudioRoute, stopAudioRoute, type AudioRoute } from './audioRoute';
import type { SourcesInfo } from '../types';
import tapUrl from './micTap.worklet.js?url';

export type LiveState = 'connecting' | 'listening' | 'speaking' | 'ended';
/** closed: the listener ended it · time: Gemini ended the session (its time limit) · dropped: the connection broke. */
export type LiveEndReason = 'closed' | 'time' | 'dropped' | 'failed' | 'mic';

export interface LiveCallbacks {
  onState(state: LiveState): void;
  onCaptions(now: { user: string; assistant: string }): void;
  onLevel(level: number, who: 'user' | 'assistant'): void;
  /** The latest reply's web sources, and whether a search is running. */
  onWeb?(web: { sources: SourcesInfo | null; searching: boolean }): void;
  /** The mic in use, and whether it has given only silence so far (a muted or virtual device). */
  onMic?(mic: { label: string; silent: boolean }): void;
  /** Where the voice plays in the Android app (null: the app cannot switch it). */
  onRoute?(route: AudioRoute | null): void;
  /** Fires once. `error` is a code for voiceNotice / micNotice when it failed. */
  onEnd(reason: LiveEndReason, error?: string): void;
}

/** Phones on mobile data take longer to open the socket and set up. */
const setupTimeoutMs = (): number => (isNativePlatform() ? 20_000 : 12_000);
const MAX_ATTEMPTS = 4;
/** Gemini closes the socket with this code when it refuses a setup field. */
const INVALID_SETUP = 1007;
/** Reconnects after the connection drops mid-session. */
const MAX_RECONNECTS = 2;
/**
 * Pure silence from the mic for this long, while listening, means it is the
 * wrong mic. Longer in the app: a phone's mic can give exact zeros while the
 * call audio starts up, and its noise suppressor can gate a quiet room to zero.
 */
const silentAfterMs = (): number => (isNativePlatform() ? 6_000 : 2_500);
/** The voice counts as playing for this long after its last sample (the room's echo). */
const ECHO_TAIL_S = 0.25;

export interface LiveOptions {
  thinking: boolean;
  voice: string;
  /** 'auto' or a Live model id. */
  model?: string;
  micId?: string;
  search?: boolean;
  speaker?: boolean;
  /** 'auto' or a language code the replies are held to. */
  language?: string;
  /** The typed chat Live voice was opened from (its latest turns). */
  context?: LiveTokenOptions['context'];
  personal?: LiveTokenOptions['personal'];
  conversationId?: string | null;
  incognito?: boolean;
}

/** What a session was asked for (a switch differs from it). */
interface Asked { model: string; voice: string; language: string }

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
  /** Web search as the listener wants it, and whether this session has it. */
  private wantSearch: boolean;
  search = false;
  private reconnecting = false;
  private drops = 0;
  private droppedWhileReconnecting = false;
  /** Android app: where the voice plays, and whether the route plugin was started. */
  route: AudioRoute | null = null;
  private routed = false;
  /** The mic says its echo cancellation is off. */
  private echoOff = false;
  private readonly guard = new EchoGuard();
  private readonly native = isNativePlatform();
  /** The model, voice and language the connected session was set up with. */
  private asked: Asked | null = null;
  /** The listener cut VinaX AI off: the rest of this reply is not played. */
  private cutOff = false;
  private readonly opts: LiveOptions;

  constructor(opts: LiveOptions, private readonly cb: LiveCallbacks) {
    this.opts = { ...opts };
    this.wantSearch = opts.search === true;
  }

  private wanted(): Asked {
    return { model: this.opts.model || 'auto', voice: this.opts.voice, language: this.opts.language || 'auto' };
  }

  /** The mic in use now. */
  get micLabel(): string {
    return micLabelOf(this.stream);
  }

  /** Start (call inside the tap: the audio context and the mic need it). */
  async start(): Promise<void> {
    const AC = typeof window === 'undefined' ? undefined : window.AudioContext ?? (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext;
    if (typeof WebSocket === 'undefined' || !AC) { this.finish('failed', 'unsupported'); return; }
    this.routed = audioRouteAvailable();
    // On the web the voice's context is made now, inside the tap (Safari
    // starts later ones suspended). With the route plugin it is made after
    // the mic opens (below).
    if (!this.routed && !this.makeOutput()) { this.finish('failed', 'unsupported'); return; }
    this.setState('connecting');
    document.addEventListener('visibilitychange', this.onVisibility);
    // Connect while the mic opens: the token, the socket and Gemini's setup
    // don't need it, and this used to wait for the mic first.
    const opening = this.open();
    let stream: MediaStream;
    try {
      stream = await openMic(this.opts.micId ?? '');
    } catch (e) {
      this.finish('mic', (e as { problem?: string }).problem ?? 'unsupported');
      return;
    }
    if (this.ended) { closeMic(stream); return; }
    this.stream = stream;
    if (this.routed) {
      // The WebView is in call mode now: put the voice on the loudspeaker
      // (or the earpiece the listener chose), then make the voice's context,
      // so its output is call audio that the echo canceller hears and the
      // route moves. (The app's WebView needs no tap to start audio.)
      this.route = await startAudioRoute(this.opts.speaker !== false);
      if (this.ended) return;
      this.cb.onRoute?.(this.route);
      if (!this.makeOutput()) { this.finish('failed', 'unsupported'); return; }
    }
    try {
      await this.startMic();
    } catch {
      this.finish('mic', 'unsupported');
      return;
    }
    if (!(await opening) || this.ended) return;
    this.setState('listening');
    this.cb.onMic?.({ label: this.micLabel, silent: false });
    this.meterLoop();
    this.applySwitch();
  }

  /** The voice's audio context, its volume and its meter; false when there is none. */
  private makeOutput(): boolean {
    const ctx = newAudioContext();
    if (!ctx) return false;
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.connect(ctx.destination);
    this.outMeter = ctx.createAnalyser();
    this.outMeter.fftSize = 1024;
    this.out.connect(this.outMeter);
    ctx.onstatechange = () => this.keepRunning(ctx);
    return true;
  }

  /** Android suspends the audio when the app leaves the screen or a call comes in: start it again once it can. */
  private keepRunning(ctx: AudioContext | null): void {
    if (this.ended || !ctx || ctx.state !== 'suspended' || document.visibilityState === 'hidden') return;
    void ctx.resume().catch(() => undefined);
  }

  private readonly onVisibility = (): void => {
    if (this.ended || document.visibilityState !== 'visible') return;
    this.keepRunning(this.ctx);
    if (this.inCtx !== this.ctx) this.keepRunning(this.inCtx);
    // The mic was cut off while the app was in the background (Android
    // allows it only on screen): that silence proves nothing about the mic.
    this.listenSince = performance.now();
  };

  /** Get a token and connect, trying other models; false when it ended instead. */
  private async open(recap?: Array<{ role: 'user' | 'assistant'; text: string }>, fail: 'failed' | 'dropped' = 'failed'): Promise<boolean> {
    const skip: string[] = [];
    let search = this.wantSearch;
    let lean = false;
    for (let attempt = 0; attempt < MAX_ATTEMPTS && !this.ended; attempt += 1) {
      const asked = this.wanted();
      const o = this.opts;
      let token: LiveTokenReply;
      try {
        token = await liveToken({
          thinking: o.thinking, skip, voice: asked.voice, search, language: asked.language,
          ...(asked.model !== 'auto' ? { model: asked.model } : {}),
          ...(recap?.length ? { recap } : {}),
          ...(o.context?.length ? { context: o.context } : {}),
          ...(o.personal ? { personal: o.personal } : {}),
          ...(o.conversationId ? { conversationId: o.conversationId } : {}),
          ...(o.incognito ? { incognito: true } : {}),
          ...(lean ? { lean: true } : {}),
        });
      } catch (e) {
        this.finish(fail, (e as { code?: string }).code ?? 'voice_unavailable');
        return false;
      }
      if (this.ended) return false;
      this.model = token.model;
      this.search = token.search === true;
      const closed = await this.connect(token);
      if (closed === null) { this.asked = asked; return true; }
      // A refused setup may be the speed settings: the same model without them.
      if (token.tuned && !lean && closed === INVALID_SETUP) { lean = true; continue; }
      lean = false;
      skip.push(token.model.id);
      // The last try goes without search, in case search is what fails.
      if (attempt === MAX_ATTEMPTS - 2) search = false;
    }
    if (!this.ended) this.finish(fail, 'voice_unavailable');
    return false;
  }

  /**
   * Switch web search during a session: the setup can't change, so this
   * reconnects, keeping the mic and the transcript.
   */
  async setSearch(on: boolean): Promise<void> {
    this.wantSearch = on;
    if (this.ended || this.reconnecting || !this.ready || this.search === on) return;
    await this.reconnect('failed');
  }

  /**
   * Switch the model, the voice or the language: like search, this
   * reconnects; while it is still connecting, it is applied once ready.
   */
  setOptions(patch: { model?: string; voice?: string; language?: string }): void {
    Object.assign(this.opts, patch);
    this.applySwitch();
  }

  /** Reconnect when the listener has switched something since this session was set up. */
  private applySwitch(): void {
    if (this.ended || this.reconnecting || !this.ready || !this.asked) return;
    const now = this.wanted();
    if (now.model === this.asked.model && now.voice === this.asked.voice && now.language === this.asked.language) return;
    void this.reconnect('failed');
  }

  /** A new socket (a fresh token), same mic, same transcript; the new session is told what was said. */
  private async reconnect(fail: 'failed' | 'dropped'): Promise<void> {
    this.reconnecting = true;
    this.ready = false;
    this.silence();
    this.transcript.complete();
    const old = this.ws;
    this.ws = null;
    try { old?.close(1000); } catch { /* closed */ }
    this.setState('connecting');
    const recap = this.transcript.turns().map((t) => ({ role: t.role, text: t.text.slice(-500) })).slice(-20);
    const ok = await this.open(recap, fail);
    this.reconnecting = false;
    if (ok && !this.ended) this.setState('listening');
    if (ok) this.applySwitch();
    if (this.droppedWhileReconnecting) {
      this.droppedWhileReconnecting = false;
      // (this.open() replaced the socket; TypeScript still thinks it is the null set above.)
      const now = this.ws as WebSocket | null;
      if (!this.ended && now?.readyState !== WebSocket.OPEN) void this.recover();
    }
  }

  /**
   * The socket closed mid-session (a phone between networks, the app in the
   * background): reconnect, at most MAX_RECONNECTS times a session.
   */
  private async recover(): Promise<void> {
    if (this.ended) return;
    if (this.reconnecting) { this.droppedWhileReconnecting = true; return; }
    if (this.drops >= MAX_RECONNECTS) { this.finish('dropped'); return; }
    this.drops += 1;
    await this.reconnect('dropped');
  }

  /**
   * Open the socket and send the setup: null once Gemini says it is ready,
   * else the close code it gave (0 when it timed out).
   */
  private connect(token: LiveTokenReply): Promise<number | null> {
    return new Promise((resolve) => {
      let settled = false;
      const settle = (closed: number | null) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(closed);
      };
      const ws = new WebSocket(`${token.url}?access_token=${encodeURIComponent(token.token)}`);
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      const timer = window.setTimeout(() => { settle(0); try { ws.close(); } catch { /* closed */ } }, setupTimeoutMs());
      ws.onopen = () => ws.send(JSON.stringify({ setup: token.setup }));
      ws.onmessage = (e) => {
        const raw = typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data as ArrayBuffer);
        for (const ev of parseServerMessage(raw)) {
          if (ev.type === 'ready') { this.ready = true; settle(null); }
          this.handle(ev);
        }
      };
      ws.onclose = (e) => {
        if (!settled) { settle(e?.code ?? 0); return; }
        if (this.ws === ws) void this.recover();
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
    inCtx.onstatechange = () => this.keepRunning(inCtx);
    const resampler = new Resampler(inCtx.sampleRate);
    this.tap.port.onmessage = (e: MessageEvent<Float32Array>) => {
      if (this.ended || this.muted || !this.ready || this.ws?.readyState !== WebSocket.OPEN) return;
      const pcm = resampler.push(e.data);
      this.ws.send(audioMessage(floatTo16(this.echoGuarded() ? this.guard.filter(pcm, this.voicePlaying(), performance.now()) : pcm)));
    };
    this.micMeter = inCtx.createAnalyser();
    this.micMeter.fftSize = 1024;
    // The tap must be pulled to run; a silent gain keeps it out of the speakers.
    const silent = inCtx.createGain();
    silent.gain.value = 0;
    this.tap.connect(silent).connect(inCtx.destination);
    this.plugMic(source);
  }

  /**
   * Whether the voice may come back through the mic: in the app, unless it
   * plays on the earpiece or a headset; anywhere the mic has no echo
   * cancellation.
   */
  private echoGuarded(): boolean {
    return this.echoOff || (this.native && this.route !== 'earpiece' && this.route !== 'headset');
  }

  /** The voice is playing, or has just stopped (its echo is still in the room). */
  private voicePlaying(): boolean {
    return !!this.ctx && (this.playing.size > 0 || (this.nextAt > 0 && this.ctx.currentTime < this.nextAt + ECHO_TAIL_S));
  }

  /** Android app: the voice on the loudspeaker (`on`) or the earpiece. The route actually in use comes back. */
  async setSpeaker(on: boolean): Promise<AudioRoute | null> {
    if (this.ended || !this.routed) return this.route;
    const r = await setSpeaker(on);
    if (r && !this.ended) this.route = r;
    this.cb.onRoute?.(this.route);
    return this.route;
  }

  private plugMic(source: MediaStreamAudioSourceNode): void {
    this.echoOff = this.stream?.getAudioTracks()[0]?.getSettings?.().echoCancellation === false;
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
      if (!this.heard && !this.muted && !this.silentShown && performance.now() - this.listenSince > silentAfterMs()) {
        this.silentShown = true;
        this.cb.onMic?.({ label: this.micLabel, silent: true });
      }
      this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }

  private handle(ev: LiveEvent): void {
    switch (ev.type) {
      case 'audio': if (!this.cutOff) this.play(ev.data); break;
      case 'heard': this.transcript.heard(ev.text); this.showCaptions(); break;
      // What VinaX AI would have said after it was cut off was never heard: leave it out.
      case 'said': if (!this.cutOff) { this.transcript.said(ev.text); this.showCaptions(); } break;
      case 'interrupted': this.cutOff = false; this.silence(); break;
      case 'turnComplete': this.cutOff = false; this.transcript.complete(); this.cb.onWeb?.(this.transcript.web()); break;
      case 'searching': this.transcript.searching(); this.cb.onWeb?.(this.transcript.web()); break;
      case 'sources': this.transcript.found(ev); this.cb.onWeb?.(this.transcript.web()); break;
      case 'goAway': this.finish('time'); break;
      default: break;
    }
  }

  private showCaptions(): void {
    this.cb.onCaptions(this.transcript.now());
    this.cb.onWeb?.(this.transcript.web());
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
    // A phone's audio runs later and its page stutters more: start a reply with a little more in hand.
    this.nextAt = Math.max(this.nextAt, ctx.currentTime + (this.native ? 0.12 : 0.04));
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

  /** The listener tapped to cut VinaX AI off: its voice stops now and the rest of this reply is dropped. */
  interrupt(): void {
    if (this.ended || this.state !== 'speaking') return;
    this.cutOff = true;
    this.silence();
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
    // After the mic is closed (the WebView has left call mode by then).
    if (this.routed) void stopAudioRoute();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
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
