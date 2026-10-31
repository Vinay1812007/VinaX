/**
 * VinaX AI — the shapes every part of the chat shares: the model registry
 * entry, the request an adapter gets, and the normalised events every
 * adapter yields whatever its provider streams. See docs/ai.md.
 */
import type { AuthEnv } from '../googleAuth';
import type { DbEnv } from '../db';

export type ProviderId = 'groq' | 'gemini' | 'openrouter' | 'nvidia' | 'cloudflare';

/** Where a model's reasoning arrives: a separate delta field, <think> tags in the text, Gemini thought parts, or nowhere. */
export type ThinkFormat = 'field' | 'tags' | 'parts' | 'none';

export interface ModelFlags {
  vision: boolean;
  pdf: boolean;
  /** Native web-search grounding that is free on the current tier (phase 3 turns it on). */
  grounding: boolean;
  reasoning: boolean;
  /** Capable enough to follow the artifacts contract (phase 5). */
  artifacts: boolean;
  /** Accepts a system role; false means the system text is put in front of the first user turn. */
  systemRole: boolean;
  thinkFormat: ThinkFormat;
}

/** Picker groups; null = failover only, never shown. */
export type ModelGroup = 'fast' | 'balanced' | 'smart' | 'vision' | 'code' | 'cloudflare';

export interface ModelSpec {
  /** Registry id, unique across providers: `<provider>:<upstream id>`. */
  id: string;
  provider: ProviderId;
  /** The id the provider's API takes. */
  upstream: string;
  name: string;
  group: ModelGroup | null;
  /** 'fast' models get the compact system prompt. */
  tier: 'fast' | 'full';
  description: string;
  flags: ModelFlags;
  maxContextChars: number;
  maxOutput: number;
  /** Extra request fields sent on every call (provider-specific). */
  params?: Record<string, unknown>;
  /** Extra request fields when Extended thinking asks for reasoning 'high'. */
  highParams?: Record<string, unknown>;
  /** Set when the id still needs confirming against the owner's account (ai-probe). */
  unconfirmed?: boolean;
}

export interface MessagePart {
  type: 'text' | 'attachment';
  text?: string;
  id?: string;
}

/** One turn as the adapters see it. */
export interface NormalizedMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface ChatRequest {
  model: ModelSpec;
  system: string;
  messages: NormalizedMessage[];
  maxOutputTokens: number;
  temperature?: number;
  reasoning: 'off' | 'default' | 'high';
  webSearch: boolean;
  signal: AbortSignal;
}

export interface Source {
  n: number;
  url: string;
  title: string;
  site: string;
  snippet?: string;
}

export type ProviderEvent =
  | { type: 'text'; delta: string }
  | { type: 'thinking'; delta: string }
  | { type: 'sources'; items: Source[]; queries: string[]; entryPointHtml?: string }
  | { type: 'usage'; input: number; output: number }
  | { type: 'end'; reason: 'stop' | 'length' | 'content_filter' };

/** The Workers AI binding, as much of it as VinaX uses. */
export interface WorkersAiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

export interface AiKeysEnv {
  GROQ_API_KEY?: string;
  GEMINI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  NVIDIA_API_KEY?: string;
  AI?: WorkersAiBinding;
}

export type AiEnv = AuthEnv & DbEnv & AiKeysEnv & { TELEMETRY_PEPPER?: string };

export interface Adapter {
  stream(env: AiEnv, req: ChatRequest): AsyncGenerator<ProviderEvent>;
}
