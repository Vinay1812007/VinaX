/**
 * VinaX AI — one answer, not a stream: `completeText` runs a ladder through
 * the same failover loop the chat uses and collects the text; `completeJson`
 * does the same and parses the answer as JSON, with one repair turn when
 * the first answer does not parse or does not validate. Built for the
 * personal engine's composer and playlist builder, usable by anything that
 * needs a structured answer. Every failure is a null, never a throw.
 */
import { aiSettings, registryFor } from './config';
import { ladderModels, type LadderName } from './models';
import { providerConfigured } from './adapters';
import { runChat } from './router';
import type { AiEnv, ModelSpec } from './types';

export interface CompleteOptions {
  system: string;
  user: string;
  /** The ladder to walk (default `default`), unless `candidates` is given. */
  ladder?: LadderName;
  candidates?: readonly ModelSpec[];
  maxOutputTokens?: number;
  temperature?: number;
  firstEventMs?: number;
  budgetMs?: number;
  signal?: AbortSignal;
}

export interface Completion { text: string; spec: ModelSpec | null; ms: number }

/** The models this Worker can call for a ladder, after the owner's overrides; the default ladder when a ladder is empty. */
export async function candidatesFor(env: AiEnv, ladder: LadderName = 'default'): Promise<ModelSpec[]> {
  const registry = registryFor(await aiSettings(env)).filter((spec) => providerConfigured(env, spec.provider));
  const picked = ladderModels(registry, ladder);
  if (picked.length) return picked;
  const fallback = ladderModels(registry, 'default');
  return fallback.length ? fallback : registry.filter((spec) => spec.group !== null);
}

export async function completeText(env: AiEnv, o: CompleteOptions): Promise<Completion | null> {
  const candidates = o.candidates ?? (await candidatesFor(env, o.ladder));
  if (!candidates.length) return null;
  const ac = new AbortController();
  const onAbort = () => ac.abort();
  o.signal?.addEventListener('abort', onAbort, { once: true });
  const started = Date.now();
  let text = '';
  let spec: ModelSpec | null = null;
  try {
    for await (const ev of runChat(env, {
      candidates,
      picked: false,
      build: (model) => ({
        model,
        system: o.system,
        messages: [{ role: 'user', text: o.user }],
        maxOutputTokens: o.maxOutputTokens ?? 1_024,
        temperature: o.temperature ?? 0.4,
        reasoning: 'off',
        webSearch: false,
      }),
      signal: ac.signal,
      firstEventMs: o.firstEventMs ?? 6_000,
      budgetMs: o.budgetMs ?? 12_000,
    })) {
      if (ev.type === 'model') { spec = ev.spec; text = ''; }
      else if (ev.type === 'text') text += ev.delta;
      else if (ev.type === 'failed') return text.trim() && ev.partial ? { text, spec, ms: Date.now() - started } : null;
    }
  } catch {
    return null;
  } finally {
    o.signal?.removeEventListener('abort', onAbort);
  }
  return text.trim() ? { text, spec, ms: Date.now() - started } : null;
}

/**
 * The first JSON value in a model's answer: reasoning tags and code fences
 * are stripped, then the first balanced `{…}` or `[…]` is parsed. Undefined
 * when there is none.
 */
export function extractJson(raw: string): unknown {
  const text = raw.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').replace(/```(?:json)?/gi, '');
  const start = text.search(/[[{]/);
  if (start < 0) return undefined;
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ']') {
      depth -= 1;
      if (depth === 0) {
        if (ch !== close) return undefined;
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

export interface JsonOptions<T> extends CompleteOptions {
  /** The typed value, or null when the shape is wrong (the repair turn then runs once). */
  validate(value: unknown): T | null;
  repair?: boolean;
}

export async function completeJson<T>(env: AiEnv, o: JsonOptions<T>): Promise<{ value: T; spec: ModelSpec | null; ms: number; repaired: boolean } | null> {
  const started = Date.now();
  const first = await completeText(env, o);
  if (!first) return null;
  const parsed = extractJson(first.text);
  const value = parsed === undefined ? null : o.validate(parsed);
  if (value) return { value, spec: first.spec, ms: Date.now() - started, repaired: false };
  if (o.repair === false) return null;
  const left = (o.budgetMs ?? 12_000) - (Date.now() - started);
  if (left < 2_000) return null;
  const second = await completeText(env, {
    ...o,
    candidates: first.spec ? [first.spec] : o.candidates,
    budgetMs: left,
    temperature: 0.1,
    user: `${o.user}\n\nYour previous answer could not be used:\n<previous>\n${first.text.slice(0, 4_000)}\n</previous>\nAnswer again with exactly one JSON value that follows the schema, and nothing else.`,
  });
  if (!second) return null;
  const again = extractJson(second.text);
  const fixed = again === undefined ? null : o.validate(again);
  return fixed ? { value: fixed, spec: second.spec, ms: Date.now() - started, repaired: true } : null;
}
