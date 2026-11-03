/**
 * VinaX AI — talking to /api/ai/*. The session token is the signed-in
 * account's; no provider key ever reaches the browser. The chat stream is
 * read with fetch + ReadableStream so it can be stopped (AbortController).
 */
import { currentAccount } from '@/services/auth/google';
import { isNativePlatform } from '@/services/native';
import { SseParser } from './sse';
import type { ConversationSummary, GalleryArtifact, GalleryItem, MemoryItem, MemoryPrefs, MemoryState, ModelsResponse, Project, ProjectDetail, ServerConversation, ServerMessage, SharedChat, ShareSummary, StreamEvent } from './types';
import { setFileLimits } from './files';

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

/** Also applies the owner's file limits it carries (files.ts imports this module too; the call happens later, so the cycle is safe). */
export const getModels = (): Promise<ModelsResponse> => call<ModelsResponse>('/models').then((r) => {
  setFileLimits(r.limits);
  return r;
});
export const getConversation = (id: string): Promise<{ conversation: ServerConversation; messages: ServerMessage[] }> =>
  call(`/conversations/${encodeURIComponent(id)}`);

export const listConversations = (opts: { q?: string; cursor?: string | null } = {}): Promise<{ items: ConversationSummary[]; nextCursor: string | null }> => {
  const p = new URLSearchParams();
  if (opts.q) p.set('q', opts.q);
  if (opts.cursor) p.set('cursor', opts.cursor);
  const qs = p.toString();
  return call(`/conversations${qs ? `?${qs}` : ''}`);
};

export const patchConversation = (id: string, patch: { title?: string; starred?: boolean; activeLeafId?: string; projectId?: string | null }): Promise<{ conversation: ConversationSummary }> =>
  call(`/conversations/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) });

export const deleteConversation = (id: string): Promise<{ ok: true }> => call(`/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' });

// ---------- artifacts gallery ----------

export const listArtifacts = (opts: { kind?: GalleryItem['kind'] | null; q?: string; cursor?: string | null } = {}): Promise<{ items: GalleryItem[]; nextCursor: string | null }> => {
  const p = new URLSearchParams();
  if (opts.kind) p.set('kind', opts.kind);
  if (opts.q) p.set('q', opts.q);
  if (opts.cursor) p.set('cursor', opts.cursor);
  const qs = p.toString();
  return call(`/artifacts${qs ? `?${qs}` : ''}`);
};

/** One artifact with every version's content. */
export const getArtifact = (conversationId: string, artifactId: string): Promise<{ artifact: GalleryArtifact }> =>
  call(`/artifacts/${encodeURIComponent(conversationId)}/${encodeURIComponent(artifactId)}`);

// ---------- projects ----------

export const PROJECTS_KEY = ['vinaxai', 'projects'] as const;
export const PROJECT_LIMITS = { name: 60, description: 300, instructions: 8_000, files: 20, chars: 200_000 } as const;

export const listProjects = (): Promise<{ items: Project[] }> => call('/projects');
export const createProject = (p: { name: string; description?: string | null; instructions?: string | null }): Promise<{ project: Project }> =>
  call('/projects', { method: 'POST', body: JSON.stringify(p) });
export const getProject = (id: string): Promise<ProjectDetail> => call(`/projects/${encodeURIComponent(id)}`);
export const patchProject = (id: string, patch: { name?: string; description?: string | null; instructions?: string | null; starred?: boolean }): Promise<{ project: Project }> =>
  call(`/projects/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) });
/** `chats`: keep them as ordinary chats, or delete them with the project. */
export const deleteProject = (id: string, chats: 'keep' | 'delete'): Promise<{ ok: true; chats: number }> =>
  call(`/projects/${encodeURIComponent(id)}?chats=${chats}`, { method: 'DELETE' });

/** What a failed project request means for the listener. */
export function projectNotice(code: string): string {
  switch (code) {
    case 'too_many_projects': return 'You have 100 projects, the most there can be. Delete one to make another.';
    case 'too_many_files': return `A project can hold ${PROJECT_LIMITS.files} files. Remove one to add another.`;
    case 'knowledge_full': return 'That would put the project over its 200,000-character limit for file text. Remove a file or add a shorter one.';
    case 'not_found': return 'This project isn’t available any more.';
    case 'rate_limited': return 'That’s a lot of changes at once. Wait a minute, then try again.';
    case 'signed_out': return 'Your sign-in has expired. Sign in again to keep going.';
    case 'bad_request': return 'That couldn’t be saved. Check the name and the lengths, then try again.';
    default: return 'Something went wrong. Try again.';
  }
}

// ---------- shared links ----------

export const listShares = (conversationId?: string): Promise<{ items: ShareSummary[] }> =>
  call(`/shares${conversationId ? `?conversation=${encodeURIComponent(conversationId)}` : ''}`);

/** Make the chat's link, or take its snapshot again (the link stays the same). */
export const shareConversation = (conversationId: string): Promise<{ share: ShareSummary }> =>
  call('/shares', { method: 'POST', body: JSON.stringify({ conversationId }) });

export const stopSharing = (id: string): Promise<{ ok: true }> => call(`/shares/${encodeURIComponent(id)}`, { method: 'DELETE' });

/** A shared chat; works signed out. */
export const getSharedChat = (id: string): Promise<{ share: SharedChat }> => call(`/shares/${encodeURIComponent(id)}`);

/** A new chat of the reader's own, made from the shared one. */
export const continueSharedChat = (id: string): Promise<{ conversationId: string }> => call(`/shares/${encodeURIComponent(id)}/continue`, { method: 'POST' });

/** The address a shared chat is read at. */
export const shareUrl = (id: string): string => `${ORIGIN || window.location.origin}/vinaxai/share/${id}`;

/** What a failed share request means for the listener. */
export function shareNotice(code: string): string {
  switch (code) {
    case 'too_large': return 'This chat is too long to share. Start a new chat and share that instead.';
    case 'empty': return 'There’s nothing in this chat to share yet.';
    case 'not_found': return 'This chat isn’t available any more.';
    case 'rate_limited': return 'That’s a lot of changes at once. Wait a minute, then try again.';
    case 'signed_out': return 'Your sign-in has expired. Sign in again to share.';
    default: return 'Something went wrong. Try again.';
  }
}

// ---------- memory ----------

/** The listener's memory; a partial answer reads as on and empty. */
export async function getMemory(): Promise<MemoryState> {
  const r = await call<Partial<MemoryState>>('/memories');
  return {
    enabled: r.enabled !== false,
    prefs: { use: r.prefs?.use !== false, learn: r.prefs?.learn !== false },
    items: Array.isArray(r.items) ? r.items : [],
    max: typeof r.max === 'number' ? r.max : 50,
  };
}

export const addMemory = (text: string): Promise<{ item: MemoryItem }> => call('/memories', { method: 'POST', body: JSON.stringify({ text }) });

export const deleteMemory = (id: string): Promise<{ ok: true }> => call(`/memories/${encodeURIComponent(id)}`, { method: 'DELETE' });

/** Forget everything. */
export const forgetAllMemory = (): Promise<{ ok: true; removed: number }> => call('/memories', { method: 'DELETE' });

export const setMemoryPrefs = (patch: Partial<MemoryPrefs>): Promise<{ prefs: MemoryPrefs }> => call('/memories/prefs', { method: 'PUT', body: JSON.stringify(patch) });

/** What a failed memory request means for the listener. */
export function memoryNotice(code: string): string {
  switch (code) {
    case 'sensitive': return 'That looks like a password, a number or contact details. Memory doesn’t keep those.';
    case 'full': return 'Memory is full. Delete a memory to add another.';
    case 'memory_off': return 'Memory is switched off for VinaX AI right now.';
    case 'rate_limited': return 'That’s a lot of changes at once. Wait a minute, then try again.';
    case 'signed_out': return 'Your sign-in has expired. Sign in again to change your memory.';
    case 'not_found': return 'That memory is already gone.';
    default: return 'Something went wrong. Try again.';
  }
}

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
  /** VinaX AI settings → Personalisation; used for this reply only. */
  personal?: { name?: string; about?: string; instructions?: string; style?: string };
  /** A new chat starts in this project. */
  projectId?: string;
  /** An incognito chat: no memory is read or written. */
  incognito?: boolean;
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
  /** The setup carries the web search tool. */
  search?: boolean;
  expiresAt: string;
}

export const liveToken = (opts: { thinking: boolean; skip: string[]; voice?: string; model?: string; search?: boolean; recap?: Array<{ role: 'user' | 'assistant'; text: string }> }): Promise<LiveTokenReply> =>
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
