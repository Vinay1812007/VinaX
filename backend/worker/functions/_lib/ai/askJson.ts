/**
 * One short backstage task for VinaX AI (memory learning): the system text,
 * the input as material, and a JSON object back within a deadline. Moved
 * here from the music AI file when the music side lost its AI (1.14).
 */
import { runChat } from './router';
import type { AiEnv, ModelSpec } from './types';

/** The first JSON object in a model's answer: reasoning tags, code fences and chatter around it are ignored. */
export function extractJson(text: string): unknown {
  const t = text.replace(/<think>[\s\S]*?(<\/think>|$)/gi, '').replace(/```(?:json)?/gi, '');
  const start = t.indexOf('{');
  if (start < 0) return null;
  // Walk to the matching brace, respecting strings, so trailing chatter cannot break the parse.
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < t.length; i += 1) {
    const c = t[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(t.slice(start, i + 1)) as unknown;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export interface JsonAnswer {
  value: unknown;
  model: ModelSpec;
}

/**
 * One short backstage task: the system text, the input as material, and the
 * whole answer within `deadlineMs`. Walks the ladder like the chat does
 * (a model that fails before answering is replaced by the next); returns
 * null on timeout, on failure, or when the answer holds no JSON object.
 */
export async function askJson(env: AiEnv, candidates: readonly ModelSpec[], task: { system: string; input: unknown; deadlineMs: number; maxOutputTokens: number; signal?: AbortSignal }): Promise<JsonAnswer | null> {
  if (!candidates.length) return null;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), Math.max(200, task.deadlineMs));
  const onOuter = (): void => ac.abort();
  task.signal?.addEventListener('abort', onOuter, { once: true });
  let text = '';
  let model: ModelSpec | null = null;
  try {
    for await (const ev of runChat(env, {
      candidates,
      picked: false,
      build: (spec) => ({
        model: spec,
        system: task.system,
        messages: [{ role: 'user', text: `<input>\n${JSON.stringify(task.input)}\n</input>` }],
        maxOutputTokens: task.maxOutputTokens,
        temperature: 0.2,
        reasoning: 'off',
        webSearch: false,
      }),
      signal: ac.signal,
      // Room for one failover inside the deadline.
      firstEventMs: Math.max(300, Math.floor(task.deadlineMs * 0.6)),
      budgetMs: task.deadlineMs,
    })) {
      if (ev.type === 'model') {
        model = ev.spec;
        text = '';
      } else if (ev.type === 'text') text += ev.delta;
      else if (ev.type === 'failed') return null;
    }
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    task.signal?.removeEventListener('abort', onOuter);
  }
  if (ac.signal.aborted || !model) return null;
  const value = extractJson(text);
  return value == null ? null : { value, model };
}
