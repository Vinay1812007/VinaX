/**
 * VinaX AI — talking to /api/ai/*. The session token is the signed-in
 * account's; no provider key ever reaches the browser. The chat stream is
 * read with fetch + ReadableStream so it can be stopped (AbortController).
 */
import { currentAccount } from '@/services/auth/google';
import { isNativePlatform } from '@/services/native';
import { SseParser } from './sse';
import type { ModelsResponse, ServerConversation, ServerMessage, StreamEvent } from './types';

const ORIGIN = isNativePlatform() ? 'https://www.vinaxmusic.online' : '';
export const AI_BASE = `${ORIGIN}/api/ai`;

export class AiError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}

function headers(json = false): Record<string, string> {
  const h: Record<string, string> = { accept: 'application/json' };
  if (json) h['content-type'] = 'application/json';
  const account = currentAccount();
  if (account) h.authorization = `Bearer ${account.session}`;
  return h;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${AI_BASE}${path}`, { ...init, headers: headers(!!init.body) });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new AiError(res.status, typeof body.error === 'string' ? body.error : `http_${res.status}`);
  return body as T;
}

export const getModels = (): Promise<ModelsResponse> => call<ModelsResponse>('/models');
export const getConversation = (id: string): Promise<{ conversation: ServerConversation; messages: ServerMessage[] }> =>
  call(`/conversations/${encodeURIComponent(id)}`);

export interface ChatRequestBody {
  conversationId: string | null;
  parentMessageId?: string | 'root';
  content: Array<{ type: 'text'; text: string }>;
  mode: 'auto' | 'model';
  model?: string;
  extendedThinking?: boolean;
  timezone?: string;
  locale?: string;
}

/** What a failed request means for the listener (never a raw error). */
export function noticeFor(code: string): string {
  switch (code) {
    case 'ai_disabled': return 'VinaX AI is taking a break. Try again later.';
    case 'ai_not_configured': return 'VinaX AI is unavailable right now.';
    case 'signed_out': return 'Your sign-in has expired. Sign in again to keep chatting.';
    case 'rate_limited': return 'That’s a lot of messages at once. Wait a minute, then try again.';
    case 'too_large':
    case 'too_long': return 'That message is too long to send.';
    case 'conversation_full': return 'This chat is full. Start a new chat to keep going.';
    case 'not_found': return 'This chat isn’t available any more.';
    case 'network': return 'You seem to be offline. Check your connection and try again.';
    default: return 'Something went wrong sending that. Try again.';
  }
}

/**
 * POST /api/ai/chat and hand each stream event to `onEvent`. Resolves when
 * the stream ends; rejects with AiError when the request is refused before
 * the stream starts, or with the abort when the listener stops.
 */
export async function streamChat(body: ChatRequestBody, onEvent: (ev: StreamEvent) => void, signal: AbortSignal): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${AI_BASE}/chat`, { method: 'POST', headers: { ...headers(true), accept: 'text/event-stream' }, body: JSON.stringify(body), signal });
  } catch (e) {
    if (signal.aborted) throw e;
    throw new AiError(0, 'network');
  }
  if (!res.ok || !res.body) {
    const err = (await res.json().catch(() => ({}))) as { error?: unknown };
    throw new AiError(res.status, typeof err.error === 'string' ? err.error : `http_${res.status}`);
  }
  const parser = new SseParser();
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const ev of parser.push(value)) onEvent(ev);
  }
  for (const ev of parser.end()) onEvent(ev);
}
