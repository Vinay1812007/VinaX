/**
 * VinaX AI — talking to /api/ai/*. The session token is the signed-in
 * account's; no provider key ever reaches the browser. The chat stream is
 * read with fetch + ReadableStream so it can be stopped (AbortController).
 */
import { currentAccount } from '@/services/auth/google';
import { isNativePlatform } from '@/services/native';
import { SseParser } from './sse';
import type { ConversationSummary, ModelsResponse, ServerConversation, ServerMessage, StreamEvent } from './types';

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

export const listConversations = (opts: { q?: string; cursor?: string | null } = {}): Promise<{ items: ConversationSummary[]; nextCursor: string | null }> => {
  const p = new URLSearchParams();
  if (opts.q) p.set('q', opts.q);
  if (opts.cursor) p.set('cursor', opts.cursor);
  const qs = p.toString();
  return call(`/conversations${qs ? `?${qs}` : ''}`);
};

export const patchConversation = (id: string, patch: { title?: string; starred?: boolean; activeLeafId?: string }): Promise<{ conversation: ConversationSummary }> =>
  call(`/conversations/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) });

export const deleteConversation = (id: string): Promise<{ ok: true }> => call(`/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' });

/** Every chat as one JSON file (GET /api/ai/export). */
export async function fetchExport(): Promise<Blob> {
  const res = await fetch(`${AI_BASE}/export`, { headers: headers() });
  if (!res.ok) throw new AiError(res.status, `http_${res.status}`);
  return res.blob();
}

export interface ChatRequestBody {
  conversationId: string | null;
  parentMessageId?: string | 'root';
  continueFrom?: string;
  content: Array<{ type: 'text'; text: string } | { type: 'attachment'; id: string }>;
  mode: 'auto' | 'model';
  model?: string;
  extendedThinking?: boolean;
  webSearch?: 'auto' | 'on' | 'off';
  artifacts?: boolean;
  timezone?: string;
  locale?: string;
}

// ---------- voice (phase 6) ----------

/** A dictation clip becomes text (never sent as a message by itself). */
export async function transcribeClip(clip: Blob, signal?: AbortSignal): Promise<string> {
  const type = (clip.type || 'audio/webm').split(';')[0];
  let res: Response;
  try {
    res = await fetch(`${AI_BASE}/transcribe`, { method: 'POST', headers: { ...headers(), 'content-type': type }, body: clip, signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new AiError(0, 'network');
  }
  const body = (await res.json().catch(() => ({}))) as { text?: unknown; error?: unknown };
  if (!res.ok) throw new AiError(res.status, typeof body.error === 'string' ? body.error : `http_${res.status}`);
  return typeof body.text === 'string' ? body.text : '';
}

/** Start Read aloud: the response streams speech frames (see speechStream.ts). */
export async function speakText(text: string, voices: { voice?: string; liveVoice?: string }, signal: AbortSignal): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${AI_BASE}/speak`, { method: 'POST', headers: headers(true), body: JSON.stringify({ text, ...voices }), signal });
  } catch (e) {
    if (signal.aborted) throw e;
    throw new AiError(0, 'network');
  }
  if (!res.ok || !res.body) {
    const err = (await res.json().catch(() => ({}))) as { error?: unknown };
    throw new AiError(res.status, typeof err.error === 'string' ? err.error : `http_${res.status}`);
  }
  return res;
}

export interface LiveTokenReply {
  token: string;
  url: string;
  setup: Record<string, unknown> & { model: string };
  model: { id: string; name: string };
  expiresAt: string;
}

export const liveToken = (opts: { thinking: boolean; skip: string[]; voice?: string }): Promise<LiveTokenReply> =>
  call('/live-token', { method: 'POST', body: JSON.stringify({ ...opts, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, locale: navigator.language }) });

export const saveLiveTranscript = (body: { conversationId: string | null; parentMessageId?: string; model: string; turns: Array<{ role: 'user' | 'assistant'; text: string }> }): Promise<{ conversationId: string; messageIds: string[] }> =>
  call('/live-transcript', { method: 'POST', body: JSON.stringify(body) });

/** What a failed voice request means for the listener. */
export function voiceNotice(code: string): string {
  switch (code) {
    case 'voice_busy': return 'Voice is busy right now. Try again in a minute.';
    case 'rate_limited': return 'That’s a lot of voice requests at once. Wait a minute, then try again.';
    case 'too_large': return 'That recording is too long. Keep it under two minutes.';
    case 'unsupported_type': return 'That recording couldn’t be read. Try again.';
    case 'network': return 'You seem to be offline. Check your connection and try again.';
    case 'signed_out':
    case 'ai_disabled':
    case 'ai_not_configured': return noticeFor(code);
    default: return 'Voice isn’t available right now. Try again later.';
  }
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
