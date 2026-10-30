/**
 * VinaX AI — Auto's ladder choice and the failover loop.
 *
 * `pickLadder` uses cheap heuristics, never an extra model call.
 * `runChat` walks the candidates: a model that fails before the first
 * answer-text token is replaced by the next one (Auto only); after the first
 * token a failure ends the reply as an error, keeping the partial text. A
 * model the listener picked is never swapped: its failure is reported so the
 * page can offer Auto or alternatives. Every failure feeds the cooldowns.
 */
import { ADAPTERS } from './adapters';
import { isCooling, noteFailure } from './cooldown';
import { asProviderError, ProviderError } from './errors';
import type { LadderName } from './models';
import type { Adapter, AiEnv, ChatRequest, ModelSpec, ProviderEvent, ProviderId } from './types';

export interface LadderSignals {
  /** The latest user message's text. */
  text: string;
  /** Characters in the whole thread (all turns). */
  threadChars: number;
  hasImages: boolean;
  hasPdf: boolean;
  extendedThinking: boolean;
}

export const LONG_THREAD_CHARS = 150_000;

const CODE_CUES = /```|\bfunction\b|\bbugs?\b|stack ?trace|traceback|exception|\berror:|\bat [\w.$<>]+ \(|\bconst |\blet |\bdef |\bclass |\bimport |#include|\bSELECT\b.+\bFROM\b|=>|\b\w+\.(?:js|jsx|ts|tsx|py|java|kt|go|rs|rb|php|cs|cpp|c|h|swift|sql|sh|html|css|json|ya?ml|toml|vue|svelte|dart)\b|\bregex\b|\bcompile|\bdebug/i;
const SMALL_TALK = /^(?:hi+|hey+|hello+|hiya|yo|sup|thanks?|thank you|thx|ty|ok(?:ay)?|cool|nice|great|awesome|good (?:morning|afternoon|evening|night)|gm|gn|bye|see you|lol|haha+|namaste)\b/i;

export const hasCodeCues = (text: string): boolean => CODE_CUES.test(text);

export function isSmallTalk(text: string): boolean {
  const t = text.trim();
  if (!t || t.includes('?')) return false;
  const words = t.split(/\s+/).length;
  return words < 6 && SMALL_TALK.test(t) && !hasCodeCues(t);
}

/** The ladder for a message, checked in this order: images, long/PDF, thinking, code, small talk, default. */
export function pickLadder(s: LadderSignals): LadderName {
  if (s.hasImages) return 'vision';
  if (s.hasPdf || s.threadChars > LONG_THREAD_CHARS) return 'long';
  if (s.extendedThinking) return 'deep';
  if (hasCodeCues(s.text)) return 'code';
  if (isSmallTalk(s.text)) return 'fast';
  return 'default';
}

/** Candidates in the order to try: resting ones are skipped, unless every one is resting. */
export function orderByRest(candidates: readonly ModelSpec[], now = Date.now()): ModelSpec[] {
  const awake = candidates.filter((spec) => !isCooling(spec, now));
  return awake.length ? awake : candidates.slice();
}

export type RouterEvent =
  | ProviderEvent
  /** This model is now answering (sent on its first event; again after a failover). */
  | { type: 'model'; spec: ModelSpec }
  /** The reply failed. `partial`: answer text had already been sent. */
  | { type: 'failed'; spec: ModelSpec | null; error: ProviderError; partial: boolean };

export interface RunOptions {
  candidates: readonly ModelSpec[];
  /** The listener picked this model: never swap it. */
  picked: boolean;
  build(spec: ModelSpec): Omit<ChatRequest, 'signal'>;
  signal: AbortSignal;
  /** Time allowed until the model's first event. */
  firstEventMs: number;
  /** Time allowed for one model's whole reply. */
  budgetMs: number;
  adapters?: Readonly<Record<ProviderId, Adapter>>;
  now?: () => number;
}

export async function* runChat(env: AiEnv, o: RunOptions): AsyncGenerator<RouterEvent> {
  const now = o.now ?? Date.now;
  const adapters = o.adapters ?? ADAPTERS;
  const order = o.picked ? o.candidates.slice(0, 1) : orderByRest(o.candidates, now());
  let lastError: ProviderError | null = null;
  let lastSpec: ModelSpec | null = null;

  for (const spec of order) {
    if (o.signal.aborted) return;
    const ac = new AbortController();
    const onOuter = (): void => ac.abort(o.signal.reason);
    o.signal.addEventListener('abort', onOuter, { once: true });
    let first: ReturnType<typeof setTimeout> | undefined = setTimeout(() => ac.abort(new ProviderError('timeout')), o.firstEventMs);
    const budget = setTimeout(() => ac.abort(new ProviderError('timeout')), o.budgetMs);
    let announced = false;
    let textStarted = false;
    try {
      for await (const ev of adapters[spec.provider].stream(env, { ...o.build(spec), signal: ac.signal })) {
        if (first) {
          clearTimeout(first);
          first = undefined;
        }
        if (!announced) {
          announced = true;
          yield { type: 'model', spec };
        }
        if (ev.type === 'end') {
          // A reply cut short by its budget ends "normally" in the adapter.
          if (ac.signal.aborted && !o.signal.aborted) throw ac.signal.reason;
          yield ev;
          return;
        }
        if (ev.type === 'text') textStarted = true;
        yield ev;
      }
      throw new ProviderError('upstream');
    } catch (e) {
      if (o.signal.aborted) return;
      const err = ac.signal.aborted ? (ac.signal.reason instanceof ProviderError ? ac.signal.reason : new ProviderError('timeout')) : asProviderError(e);
      noteFailure(spec, err, now());
      if (textStarted || o.picked) {
        yield { type: 'failed', spec, error: err, partial: textStarted };
        return;
      }
      lastError = err;
      lastSpec = spec;
    } finally {
      if (first) clearTimeout(first);
      clearTimeout(budget);
      o.signal.removeEventListener('abort', onOuter);
    }
  }
  yield { type: 'failed', spec: lastSpec, error: lastError ?? new ProviderError('not_configured'), partial: false };
}

/** A short, human reason for a failure; never a raw provider message. */
export function humanReason(err: ProviderError, spec: ModelSpec | null): string {
  const who = spec?.name ?? 'VinaX AI';
  switch (err.kind) {
    case 'rate':
    case 'quota':
      return `${who} is busy right now.`;
    case 'timeout':
      return `${who} took too long to answer.`;
    case 'gone':
    case 'auth':
    case 'forbidden':
    case 'not_configured':
      return `${who} isn't available right now.`;
    case 'empty':
      return `${who} didn't send an answer.`;
    default:
      return `${who} couldn't answer just now.`;
  }
}
