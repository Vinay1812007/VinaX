/**
 * VinaX AI — the chat's model start for pass-through streaming.
 *
 * Why: the Worker runs on the free plan, which allows 10 ms of CPU per
 * request. Relaying a reply token by token through JavaScript cost about a
 * second of CPU for a long answer (one wake-up per network packet), and the
 * platform cut such replies off mid-stream ("Worker exceeded CPU time
 * limit"; the page said "The connection dropped before the reply
 * finished"). A body handed on untouched costs next to nothing (a 13 MB
 * download through /api/apk used 2 ms), so the chat now gives the page the
 * provider's own bytes and the page reads them (frontend vinaxai/wire.ts).
 *
 * `openModel` walks the candidates like `runChat`: a model that refuses, or
 * sends nothing before `firstEventMs`, or opens with an error frame, is
 * replaced by the next one (Auto only; a picked model is never swapped).
 * Once a model's first `data:` line has arrived it is the answer: its body is
 * copied: one copy for the page (`live`, from the first byte), one to look
 * at the first line, and one read whole when the reply ends (`whole`), which
 * the route parses once to save the reply. Failures feed the cooldowns.
 */
import { ADAPTERS } from './adapters';
import { noteFailure } from './cooldown';
import { asProviderError, ProviderError } from './errors';
import { orderByRest, type RunOptions } from './router';
import type { AiEnv, ModelSpec, ProviderEvent, ProviderId, WireAdapter, WireFormat } from './types';

export interface OpenedModel {
  spec: ModelSpec;
  wire: WireFormat;
  /** The provider's bytes from the first one, for the page. */
  live: ReadableStream<Uint8Array>;
  /**
   * The same bytes as text; call it once the page's copy has been handed on
   * (rejects if the reply broke off). Reading this copy alongside the page's
   * held the page's back: workerd's tee then passed the bytes on in 64 KB
   * blocks, so a reply reached the page in one lump at the end.
   */
  whole(): Promise<string>;
  /** When the model's first bytes arrived. */
  firstAt: number;
  /** Ends the provider request (Stop, a page that went away, the time budget). */
  abort(reason?: unknown): void;
  /** The reply is over: clears its time budget. */
  finish(): void;
}

export type OpenResult =
  | { ok: true; opened: OpenedModel }
  | { ok: false; spec: ModelSpec | null; error: ProviderError };

export interface OpenOptions extends Omit<RunOptions, 'adapters'> {
  adapters?: Readonly<Record<ProviderId, WireAdapter>>;
}

/** A stream of the given chunks, then closed (for parsing what has arrived). */
export function bytesBody(chunks: readonly Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (i < chunks.length) c.enqueue(chunks[i++]);
      else c.close();
    },
  });
}

const enc = new TextEncoder();
/** A whole body as a stream, for the adapters' parsers. */
export const textBody = (text: string): ReadableStream<Uint8Array> => bytesBody(text ? [enc.encode(text)] : []);

/** Runs a parser to the end and collects what it produced. */
export async function collect(events: AsyncGenerator<ProviderEvent>): Promise<{ events: ProviderEvent[]; error: ProviderError | null }> {
  const out: ProviderEvent[] = [];
  try {
    for await (const ev of events) out.push(ev);
    return { events: out, error: null };
  } catch (e) {
    return { events: out, error: asProviderError(e) };
  }
}

/** Waits for `p`, or rejects as soon as `signal` aborts (with its reason). */
function abortable<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => { signal.removeEventListener('abort', onAbort); resolve(v); },
      (e) => { signal.removeEventListener('abort', onAbort); reject(e); },
    );
  });
}

/** A complete `data:` line with something in it (not a comment or keep-alive). */
const DATA_LINE = /^data:[ \t]*\S.*\r?\n/m;

export async function openModel(env: AiEnv, o: OpenOptions): Promise<OpenResult> {
  const now = o.now ?? Date.now;
  const adapters = o.adapters ?? ADAPTERS;
  const order = o.picked ? o.candidates.slice(0, 1) : orderByRest(o.candidates, now());
  let lastError: ProviderError | null = null;
  let lastSpec: ModelSpec | null = null;
  const aborted = (): OpenResult => ({ ok: false, spec: lastSpec, error: new ProviderError('timeout') });

  for (const spec of order) {
    if (o.signal.aborted) return aborted();
    // Built before the clock starts: a search is not the model's first-event time.
    const req = await o.build(spec);
    if (o.signal.aborted) return aborted();
    const adapter = adapters[spec.provider];
    const ac = new AbortController();
    const onOuter = (): void => ac.abort(o.signal.reason);
    o.signal.addEventListener('abort', onOuter, { once: true });
    const first = setTimeout(() => ac.abort(new ProviderError('timeout')), o.firstEventMs);
    const budget = setTimeout(() => ac.abort(new ProviderError('timeout')), o.budgetMs);
    const finish = (): void => {
      clearTimeout(first);
      clearTimeout(budget);
      o.signal.removeEventListener('abort', onOuter);
    };
    let live: ReadableStream<Uint8Array> | null = null;
    let probe: ReadableStream<Uint8Array> | null = null;
    let save: ReadableStream<Uint8Array> | null = null;
    try {
      const body = await abortable(adapter.open(env, { ...req, signal: ac.signal }), ac.signal);
      // Three copies of one body: the page's, one to look at the first line,
      // and one read whole at the end (a stream that was read from cannot be).
      let rest: ReadableStream<Uint8Array>;
      [live, rest] = body.tee();
      [probe, save] = rest.tee();
      // Read only when asked (after the page's copy): the tee keeps the bytes meanwhile.
      const kept = save;
      let read: Promise<string> | null = null;
      const whole = (): Promise<string> => (read ??= new Response(kept).text());
      // Wait for the first real line, then check it is not an error.
      const reader = probe.getReader();
      const head: Uint8Array[] = [];
      const dec = new TextDecoder();
      let seen = '';
      let ended = false;
      while (!DATA_LINE.test(seen)) {
        const r = await abortable(reader.read(), ac.signal);
        if (r.done) { ended = true; break; }
        head.push(r.value);
        seen += dec.decode(r.value, { stream: true });
      }
      void reader.cancel().catch(() => undefined);
      const checked = await collect(adapter.parse(bytesBody(head)));
      // "empty" only means no answer text yet, unless the reply already ended.
      if (checked.error && (ended || checked.error.kind !== 'empty')) throw checked.error;
      clearTimeout(first);
      return {
        ok: true,
        opened: { spec, wire: adapter.wire, live, whole, firstAt: now(), abort: (reason) => ac.abort(reason ?? new ProviderError('timeout')), finish },
      };
    } catch (e) {
      finish();
      ac.abort();
      void live?.cancel().catch(() => undefined);
      void probe?.cancel().catch(() => undefined);
      void save?.cancel().catch(() => undefined);
      if (o.signal.aborted) return aborted();
      const err = e instanceof ProviderError ? e : asProviderError(e, ac.signal);
      noteFailure(spec, err, now());
      lastError = err;
      lastSpec = spec;
      if (o.picked) return { ok: false, spec, error: err };
    }
  }
  return { ok: false, spec: lastSpec, error: lastError ?? new ProviderError('not_configured') };
}
