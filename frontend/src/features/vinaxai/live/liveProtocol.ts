/**
 * VinaX AI Live voice — the pieces of Gemini Live's WebSocket protocol the
 * page needs, kept free of the browser so they can be tested:
 *
 *   page → Gemini   { setup }  (from POST /api/ai/live-token, sent first)
 *                   { realtimeInput: { audio: { data: <base64 PCM>, mimeType: "audio/pcm;rate=16000" } } }
 *                   { realtimeInput: { audioStreamEnd: true } }   (mic muted)
 *   Gemini → page   { setupComplete }
 *                   { serverContent: { modelTurn: { parts: [{ inlineData: { data } }] },
 *                                      inputTranscription: { text }, outputTranscription: { text },
 *                                      interrupted, turnComplete,
 *                                      groundingMetadata: { groundingChunks: [{ web: { uri, title } }],
 *                                                           webSearchQueries, searchEntryPoint: { renderedContent } } } }
 *                   { goAway: { timeLeft } }
 *
 * With web search on, the model may send `executableCode` parts while it
 * searches, and the sources it used come as `groundingMetadata`.
 *
 * Mic audio goes as 16-bit PCM at 16 kHz; Gemini's voice comes back as
 * 16-bit PCM at 24 kHz. Shapes checked against Google's Live API reference
 * (2026-10-31); see docs/ai.md.
 */

import type { Source, SourcesInfo } from '../types';

export const INPUT_RATE = 16_000;
export const OUTPUT_RATE = 24_000;
export const INPUT_MIME = `audio/pcm;rate=${INPUT_RATE}`;

/** Linear-interpolation resampler that keeps its place across batches. */
export class Resampler {
  private pos = 0;
  private last = 0;

  constructor(private readonly from: number, private readonly to = INPUT_RATE) {}

  push(input: Float32Array): Float32Array {
    if (this.from === this.to) return input.slice();
    const step = this.from / this.to;
    const out: number[] = [];
    // `pos` is where the next output sample falls, in input samples, where
    // -1 is the previous batch's last sample.
    while (this.pos < input.length - 1 + 1e-9) {
      const i = Math.floor(this.pos);
      const frac = this.pos - i;
      const a = i < 0 ? this.last : input[i];
      const b = input[Math.min(input.length - 1, i + 1)];
      out.push(a + (b - a) * frac);
      this.pos += step;
    }
    this.pos -= input.length;
    this.last = input[input.length - 1] ?? this.last;
    return Float32Array.from(out);
  }
}

/**
 * Keeps VinaX AI's own voice out of what is sent while it speaks, where the
 * phone's echo canceller may not catch it (the Android app's loudspeaker, or
 * a mic that reports echo cancellation off). Without it the voice comes back
 * through the mic, Gemini hears it as the listener talking over it, and the
 * reply cuts itself off ("interrupted").
 *
 * While the voice plays (and a short tail after), a batch goes as silence
 * unless the mic is loud enough to be the listener talking over it (close
 * speech is far louder at the mic than the echo the canceller leaves). Once
 * a batch gets through, the next ones do too for a moment, so a word is not
 * chopped. Silence is sent, not nothing, so the stream keeps its timing.
 */
export class EchoGuard {
  private openUntil = 0;

  /**
   * @param bargeIn RMS a batch needs to get through while the voice plays (≈ −32 dBFS).
   * @param holdMs how long the gate stays open after a loud batch.
   */
  constructor(private readonly bargeIn = 0.025, private readonly holdMs = 600) {}

  /** The batch to send: `samples` as they are, or silence of the same length. */
  filter(samples: Float32Array, voicePlaying: boolean, nowMs: number): Float32Array {
    if (!voicePlaying) return samples;
    let sum = 0;
    for (const s of samples) sum += s * s;
    const rms = samples.length ? Math.sqrt(sum / samples.length) : 0;
    if (rms >= this.bargeIn) this.openUntil = nowMs + this.holdMs;
    return nowMs < this.openUntil ? samples : new Float32Array(samples.length);
  }
}

/**
 * Keeps the room's steady noise out of what is sent. Gemini decides the
 * listener has finished when it hears a pause; in a noisy room (a fan, an
 * office, people talking nearby) the mic never goes quiet, so it kept
 * waiting: a live test on 2026-11-05 measured replies starting 6 to 40
 * seconds after the question ended.
 *
 * The gate follows the room's noise floor (in dB: down quickly, up slowly)
 * and sends a batch as silence unless it is clearly louder than that floor
 * (the listener's voice, close to the mic). Once a batch gets through, the
 * next ones do too for a moment, so word endings and short pauses are not
 * chopped. Silence is sent, not nothing, so the stream keeps its timing.
 */
export class NoiseGate {
  private floor: number | null = null;
  private openUntil = 0;

  /**
   * @param marginDb how far above the noise floor a batch must be to get through.
   * @param holdMs how long the gate stays open after a loud batch.
   * @param minDb a batch quieter than this never opens it (a near-silent room).
   */
  constructor(private readonly marginDb = 12, private readonly holdMs = 350, private readonly minDb = -60) {}

  /** The noise floor now, in dBFS (null before the first batch). */
  get floorDb(): number | null {
    return this.floor;
  }

  /** The batch to send: `samples` as they are, or silence of the same length. */
  filter(samples: Float32Array, nowMs: number): Float32Array {
    let sum = 0;
    for (const s of samples) sum += s * s;
    const db = 20 * Math.log10(Math.sqrt(samples.length ? sum / samples.length : 0) + 1e-9);
    // Digital silence (the echo guard's, a muted track) says nothing about the room.
    if (db < -120) return samples;
    const loud = this.floor !== null && db >= Math.max(this.floor + this.marginDb, this.minDb);
    if (this.floor === null) this.floor = db;
    // Quieter than the floor: follow it down quickly. Room noise just above
    // it: drift up. Speech: creep up about 1 dB a second, so a room that
    // gets lastingly louder (music on) is learned, but a sentence is not.
    else if (db < this.floor) this.floor += (db - this.floor) * 0.3;
    else if (!loud) this.floor += (db - this.floor) * 0.03;
    else this.floor += 0.05;
    if (loud) this.openUntil = nowMs + this.holdMs;
    return nowMs < this.openUntil ? samples : new Float32Array(samples.length);
  }
}

/** Floats (−1…1) to little-endian 16-bit PCM bytes. */
export function floatTo16(samples: Float32Array): Uint8Array {
  const out = new Uint8Array(samples.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, s < 0 ? Math.round(s * 32768) : Math.round(s * 32767), true);
  }
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Loudness of a batch, 0–1 (for the orb). */
export function levelOf(samples: Float32Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (const s of samples) sum += s * s;
  return Math.min(1, Math.sqrt(sum / samples.length) * 4);
}

export const audioMessage = (pcm: Uint8Array): string => JSON.stringify({ realtimeInput: { audio: { data: bytesToBase64(pcm), mimeType: INPUT_MIME } } });
export const streamEndMessage = (): string => JSON.stringify({ realtimeInput: { audioStreamEnd: true } });

export type LiveEvent =
  | { type: 'ready' }
  | { type: 'audio'; data: string }
  | { type: 'heard'; text: string }
  | { type: 'said'; text: string }
  | { type: 'interrupted' }
  | { type: 'turnComplete' }
  | { type: 'goAway' }
  /** The model is searching the web. */
  | { type: 'searching' }
  /** What a search found (links are the search's own redirects; titles are site names). */
  | { type: 'sources'; items: Array<{ url: string; title: string }>; queries: string[]; entryPointHtml?: string };

const MAX_SOURCES = 10;

interface Grounding {
  groundingChunks?: Array<{ web?: { uri?: unknown; title?: unknown } }>;
  webSearchQueries?: unknown;
  searchEntryPoint?: { renderedContent?: unknown };
}

/** Grounding metadata as a sources event (http(s) links only), or null when it names none. */
export function groundingSources(g: unknown): Extract<LiveEvent, { type: 'sources' }> | null {
  if (!g || typeof g !== 'object') return null;
  const m = g as Grounding;
  const items: Array<{ url: string; title: string }> = [];
  for (const c of Array.isArray(m.groundingChunks) ? m.groundingChunks : []) {
    const url = typeof c?.web?.uri === 'string' ? c.web.uri.trim() : '';
    if (!/^https?:\/\//i.test(url) || items.some((i) => i.url === url)) continue;
    items.push({ url, title: typeof c.web?.title === 'string' ? c.web.title.trim().slice(0, 200) : '' });
    if (items.length >= MAX_SOURCES) break;
  }
  const queries = Array.isArray(m.webSearchQueries) ? m.webSearchQueries.filter((q): q is string => typeof q === 'string').slice(0, 5) : [];
  const html = m.searchEntryPoint?.renderedContent;
  if (!items.length && typeof html !== 'string') return null;
  return { type: 'sources', items, queries, ...(typeof html === 'string' && html ? { entryPointHtml: html.slice(0, 50_000) } : {}) };
}

/** One server message as the events the page acts on (unknown parts are ignored). */
export function parseServerMessage(raw: string): LiveEvent[] {
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return [];
  }
  if (!m || typeof m !== 'object') return [];
  const out: LiveEvent[] = [];
  if ('setupComplete' in m) out.push({ type: 'ready' });
  const sc = m.serverContent as Record<string, unknown> | undefined;
  if (sc && typeof sc === 'object') {
    const heard = (sc.inputTranscription as { text?: unknown } | undefined)?.text;
    if (typeof heard === 'string' && heard) out.push({ type: 'heard', text: heard });
    const parts = ((sc.modelTurn as { parts?: unknown } | undefined)?.parts ?? []) as Array<{ inlineData?: { data?: unknown }; executableCode?: { code?: unknown } }>;
    if (Array.isArray(parts)) {
      for (const p of parts) {
        if (typeof p?.inlineData?.data === 'string') out.push({ type: 'audio', data: p.inlineData.data });
        // Search runs as a short piece of code on the model's side.
        if (typeof p?.executableCode?.code === 'string' && /search/i.test(p.executableCode.code) && !out.some((e) => e.type === 'searching')) out.push({ type: 'searching' });
      }
    }
    const said = (sc.outputTranscription as { text?: unknown } | undefined)?.text;
    if (typeof said === 'string' && said) out.push({ type: 'said', text: said });
    const found = groundingSources(sc.groundingMetadata);
    if (found) out.push(found);
    if (sc.interrupted === true) out.push({ type: 'interrupted' });
    if (sc.turnComplete === true) out.push({ type: 'turnComplete' });
  }
  if ('goAway' in m) out.push({ type: 'goAway' });
  return out;
}

export interface Turn {
  role: 'user' | 'assistant';
  text: string;
  /** A reply's web sources, saved with it. */
  sources?: Array<{ url: string; title: string }>;
}

interface Exchange {
  user: string;
  assistant: string;
  done: boolean;
  searching: boolean;
  sources: Source[];
  queries: string[];
  entryPointHtml?: string;
}

const siteOf = (title: string, url: string): string => {
  if (title) return title.replace(/^www\./, '');
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'source';
  }
};

/**
 * The session's transcript, exchange by exchange. Transcription arrives in
 * small pieces and the listener's words can land after the model has
 * started answering, so each exchange keeps both sides until it completes.
 */
export class Transcript {
  private exchanges: Exchange[] = [];

  private current(): Exchange {
    let last = this.exchanges[this.exchanges.length - 1];
    if (!last || last.done) {
      last = { user: '', assistant: '', done: false, searching: false, sources: [], queries: [] };
      this.exchanges.push(last);
    }
    return last;
  }

  searching(): void {
    this.current().searching = true;
  }

  /** Sources for the reply being given (merged, no repeats, numbered from 1). */
  found(ev: Extract<LiveEvent, { type: 'sources' }>): void {
    const e = this.current();
    e.searching = false;
    for (const i of ev.items) {
      if (e.sources.length >= MAX_SOURCES || e.sources.some((s) => s.url === i.url)) continue;
      const site = siteOf(i.title, i.url);
      e.sources.push({ n: e.sources.length + 1, url: i.url, title: i.title || site, site });
    }
    for (const q of ev.queries) if (!e.queries.includes(q)) e.queries.push(q);
    if (ev.entryPointHtml) e.entryPointHtml = ev.entryPointHtml;
  }

  /** The latest exchange's sources (kept after it completes), and whether a search is running. */
  web(): { sources: SourcesInfo | null; searching: boolean } {
    const last = this.exchanges[this.exchanges.length - 1];
    if (!last) return { sources: null, searching: false };
    const sources: SourcesInfo | null = last.sources.length
      ? { items: last.sources, via: 'grounding', queries: last.queries, ...(last.entryPointHtml ? { entryPointHtml: last.entryPointHtml } : {}) }
      : null;
    return { sources, searching: last.searching && !last.done };
  }

  heard(text: string): void {
    this.current().user += text;
  }

  said(text: string): void {
    this.current().assistant += text;
  }

  complete(): void {
    const last = this.exchanges[this.exchanges.length - 1];
    if (last) last.done = true;
  }

  /** What is being said now (for the captions). */
  now(): { user: string; assistant: string } {
    const last = this.exchanges[this.exchanges.length - 1];
    return last && !last.done ? { user: tidy(last.user), assistant: tidy(last.assistant) } : { user: '', assistant: '' };
  }

  /** Everything said, as chat turns (empty sides left out). */
  turns(): Turn[] {
    const out: Turn[] = [];
    for (const e of this.exchanges) {
      if (tidy(e.user)) out.push({ role: 'user', text: tidy(e.user) });
      if (tidy(e.assistant)) out.push({ role: 'assistant', text: tidy(e.assistant), ...(e.sources.length ? { sources: e.sources.map((s) => ({ url: s.url, title: s.title })) } : {}) });
    }
    return out;
  }
}

const tidy = (s: string): string => s.replace(/\s+/g, ' ').trim();
