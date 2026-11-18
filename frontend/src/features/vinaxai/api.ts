/**
 * VinaX AI — talking to /api/ai/*. The session token is the signed-in
 * account's; no provider key ever reaches the browser. The chat stream is
 * read with fetch + ReadableStream so it can be stopped (AbortController).
 */
import { currentAccount } from '@/services/auth/google';
import { isNativePlatform } from '@/services/native';
import { SseParser, type ChatStreamItem } from './sse';
import { WireReader, wireOf } from './wire';
import type { ConversationSummary, GalleryArtifact, GalleryItem, MemoryItem, MemoryPrefs, MemoryState, MessageFeedback, ModelsResponse, Project, ProjectDetail, ServerConversation, ServerMessage, SharedChat, ShareSummary, StreamEvent } from './types';
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

/** Delete several chats at once (the Chats page), or every chat (`all`), the way one is deleted. */
export const deleteConversations = (which: { ids: string[] } | { all: true }): Promise<{ ok: true; deleted: number }> =>
  call('/conversations', { method: 'DELETE', body: JSON.stringify(which) });

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

/** Import notes, one per line (Memory → Import): the ones kept, and how many were skipped (repeats, secrets, past the limit). */
export const importMemories = (texts: string[]): Promise<{ items: MemoryItem[]; added: number; skipped: number }> =>
  call('/memories', { method: 'POST', body: JSON.stringify({ texts }) });

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
  /** Thinking: Auto or a level (the Worker's thinking.ts). */
  thinking?: 'auto' | 'fast' | 'standard' | 'extended' | 'max';
  webSearch?: 'auto' | 'on' | 'off';
  /** Research: several planned searches, then a cited report (the composer's Research switch). */
  research?: boolean;
  artifacts?: boolean;
  timezone?: string;
  locale?: string;
  /** VinaX AI settings → Personalisation; used for this reply only. */
  personal?: { name?: string; about?: string; instructions?: string; style?: string; language?: string };
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
  /** The setup carries the speed settings (quick end of turn, quick thinking). */
  tuned?: boolean;
  /** The setup carries the music tools (live/musicTools.ts runs them). */
  music?: boolean;
  expiresAt: string;
}

export interface LiveTokenOptions {
  thinking: boolean;
  skip: string[];
  voice?: string;
  model?: string;
  search?: boolean;
  /** What was said earlier in this call (a reconnect). */
  recap?: Array<{ role: 'user' | 'assistant'; text: string }>;
  /** The typed chat Live voice was opened from. */
  context?: Array<{ role: 'user' | 'assistant'; text: string }>;
  /** 'auto' or a language code the replies are held to. */
  language?: string;
  /** Without the speed settings (the model refused them). */
  lean?: boolean;
  /** Music control: Gemini may play, pause and skip in VinaX's player. */
  music?: boolean;
  personal?: { name?: string; about?: string; instructions?: string; style?: string; language?: string };
  conversationId?: string | null;
  incognito?: boolean;
}

export const liveToken = (opts: LiveTokenOptions): Promise<LiveTokenReply> =>
  call('/live-token', { method: 'POST', body: JSON.stringify({ ...opts, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, locale: navigator.language }) });

export const saveLiveTranscript = (body: { conversationId: string | null; parentMessageId?: string; model: string; turns: Array<{ role: 'user' | 'assistant'; text: string }> }): Promise<{ conversationId: string; messageIds: string[] }> =>
  call('/live-transcript', { method: 'POST', body: JSON.stringify(body) });

/** What a failed voice request means for the listener. */
export function voiceNotice(code: string): string {
  switch (code) {
    case 'voice_busy': return 'Voice is busy right now. Try again in a minute.';
    case 'language_unavailable': return 'Can’t read this language aloud right now. Try again later.';
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

// ---------- Create image ----------

export interface ImageRequestBody {
  prompt: string;
  conversationId: string | null;
  parentMessageId?: string | 'root';
  projectId?: string;
  incognito?: boolean;
}

/** One picture from a prompt (POST /api/ai/images); the turn comes back saved, in the conversation's shapes. */
export async function createImageTurn(body: ImageRequestBody, signal?: AbortSignal): Promise<{ conversation: ServerConversation; userMessage: ServerMessage; assistantMessage: ServerMessage }> {
  let res: Response;
  try {
    res = await fetch(`${AI_BASE}/images`, { method: 'POST', headers: headers(true), body: JSON.stringify(body), signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new AiError(0, 'network');
  }
  const out = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new AiError(res.status, typeof out.error === 'string' ? out.error : `http_${res.status}`);
  // A body cut short (or read after Stop) is not a saved turn.
  const turn = out as { conversation?: ServerConversation; userMessage?: ServerMessage; assistantMessage?: ServerMessage };
  if (!turn.conversation?.id || !Array.isArray(turn.userMessage?.content) || !Array.isArray(turn.assistantMessage?.content)) throw new AiError(res.status, 'image_failed');
  return turn as { conversation: ServerConversation; userMessage: ServerMessage; assistantMessage: ServerMessage };
}

/** What a failed Create image means for the listener. */
export function imageNotice(code: string, perDay?: number): string {
  switch (code) {
    case 'empty_prompt': return 'Describe the image you want first.';
    case 'prompt_too_long': return 'That description is too long. Keep it under 1,000 characters.';
    case 'prompt_refused':
    case 'image_refused': return 'VinaX AI can’t make that image. Try describing something else.';
    case 'image_daily_limit': return perDay ? `You’ve made today’s ${perDay} images. Try again tomorrow.` : 'You’ve made all your images for today. Try again tomorrow.';
    case 'images_busy': return 'Image making is used up for today. Try again tomorrow.';
    case 'images_off': return 'Creating images is switched off right now.';
    case 'image_failed': return 'The image didn’t come out. Try again.';
    case 'rate_limited': return 'That’s a lot of images at once. Wait a minute, then try again.';
    case 'too_many_files': return 'This chat is full of files. Start a new chat to make more images.';
    default: return noticeFor(code);
  }
}

/** What a failed request means for the listener (never a raw error). */
export function noticeFor(code: string): string {
  switch (code) {
    case 'ai_disabled': return 'VinaX AI is taking a break. Try again later.';
    case 'ai_not_configured': return 'VinaX AI is unavailable right now.';
    case 'signed_out': return 'Your sign-in has expired. Sign in again to keep chatting.';
    case 'rate_limited': return 'That’s a lot of messages at once. Wait a minute, then try again.';
    case 'daily_limit': return 'You’ve reached today’s message limit for VinaX AI. Come back tomorrow.';
    case 'too_large':
    case 'too_long': return 'That message is too long to send.';
    case 'conversation_full': return 'This chat is full. Start a new chat to keep going.';
    case 'not_found': return 'This chat isn’t available any more.';
    case 'model_locked': return 'Claude isn’t open to this account. Pick another model or Auto.';
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
  // The provider's own lines arrive between the Worker's events (wire.ts).
  let wire = new WireReader('openai');
  let inRaw = false;
  const handle = (items: ChatStreamItem[]): void => {
    for (const ev of items) {
      if (ev.event === 'raw') {
        inRaw = true;
        for (const d of wire.push(ev.data)) onEvent(d);
        continue;
      }
      if (inRaw) {
        inRaw = false;
        for (const d of wire.end()) onEvent(d);
      }
      if (ev.event === 'meta') wire = new WireReader(wireOf(ev.data.wire));
      onEvent(ev);
    }
  };
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    handle(parser.push(value));
  }
  handle(parser.end());
  if (inRaw) for (const d of wire.end()) onEvent(d);
}

/** What the page saw of a reply that did not end on its own (POST /api/ai/keep). */
export interface KeepBody {
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
  text: string;
  thinking?: string;
  model?: string;
  /** end / length: the reply ended, but the Worker could not save it (too large to read again). */
  stopReason: 'aborted' | 'error' | 'end' | 'length';
  /** A Continue: `text` is the whole reply, the part already saved plus what followed. */
  continued?: boolean;
}

export function keepReply(body: KeepBody): Promise<{ ok: boolean; saved: boolean }> {
  return call<{ ok: boolean; saved: boolean }>('/keep', { method: 'POST', body: JSON.stringify(body) });
}

/** Thumbs up or down on a saved reply, or null to take it back (POST /api/ai/feedback). */
export function sendFeedback(body: { conversationId: string; messageId: string; rating: 'up' | 'down' | null; reason?: string; note?: string }): Promise<{ ok: true; feedback: MessageFeedback | null }> {
  return call<{ ok: true; feedback: MessageFeedback | null }>('/feedback', { method: 'POST', body: JSON.stringify(body) });
}
