/**
 * VinaX AI Cowork — talking to /api/ai/cowork (the Worker's
 * _lib/ai/cowork.ts). The task's event stream is Anthropic's Managed Agents
 * stream, passed through untouched; `readEvents` turns its SSE blocks into
 * event objects for events.ts.
 */
import { currentAccount } from '@/services/auth/google';
import { AI_BASE, AiError } from '../api';
import type { CoworkEvent } from './events';

export const COWORK_BASE = `${AI_BASE}/cowork`;

export interface CoworkModel { id: string; name: string; description: string }

export interface CoworkTask {
  id: string;
  title: string;
  status: string;
  createdAt: string | null;
  updatedAt: string | null;
  costCents: number | null;
  budgetCents: number | null;
  model: string | null;
}

export interface CoworkInfo {
  allowed: boolean;
  configured: boolean;
  ready: boolean;
  models: CoworkModel[];
  efforts: string[];
  defaultEffort: string;
  budgetCents: number | null;
  minBudgetCents: number;
  maxBudgetCents: number;
  maxUploadBytes: number;
  tasks: CoworkTask[];
}

export interface OutputFile { id: string; name: string; size: number; mime: string | null; createdAt: string | null }

export const COWORK_KEY = ['vinaxai', 'cowork'] as const;

function headers(json = false): Record<string, string> {
  const h: Record<string, string> = { accept: 'application/json' };
  if (json) h['content-type'] = 'application/json';
  const account = currentAccount();
  if (account) h.authorization = `Bearer ${account.session}`;
  return h;
}

/** The Worker's refusal, with Anthropic's own message when it sent one (the owner's page only). */
export class CoworkError extends AiError {
  constructor(status: number, code: string, readonly detail?: string) {
    super(status, code);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${COWORK_BASE}${path}`, { ...init, headers: { ...headers(typeof init.body === 'string'), ...(init.headers as Record<string, string> | undefined) } });
  } catch {
    throw new CoworkError(0, 'network');
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new CoworkError(res.status, typeof body.error === 'string' ? body.error : `http_${res.status}`, typeof body.message === 'string' ? body.message : undefined);
  return body as T;
}

const post = <T>(path: string, body: unknown): Promise<T> => call<T>(path, { method: 'POST', body: JSON.stringify(body) });

export const getCowork = (): Promise<CoworkInfo> => call<CoworkInfo>('');
export const setupCowork = (): Promise<{ ok: true; created: boolean; updated: boolean }> => post('/setup', {});
export const createTask = (b: { title: string; model: string; effort: string; budgetCents: number; files: Array<{ id: string; name: string }> }): Promise<{ task: CoworkTask }> => post('', b);
export const getTask = (id: string): Promise<{ task: CoworkTask }> => call(`/tasks/${encodeURIComponent(id)}`);
export const deleteTask = (id: string): Promise<{ ok: true }> => call(`/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const sendMessage = (id: string, text: string): Promise<{ ok: true }> => post(`/tasks/${encodeURIComponent(id)}/events`, { type: 'message', text });
export const interruptTask = (id: string): Promise<{ ok: true }> => post(`/tasks/${encodeURIComponent(id)}/events`, { type: 'interrupt' });
export const confirmTool = (id: string, toolUseId: string, allow: boolean, denyMessage?: string): Promise<{ ok: true }> =>
  post(`/tasks/${encodeURIComponent(id)}/events`, { type: 'confirm', toolUseId, allow, ...(denyMessage ? { denyMessage } : {}) });
export const setBudget = (id: string, cents: number): Promise<{ task: CoworkTask }> => post(`/tasks/${encodeURIComponent(id)}/budget`, { cents });
export const addTaskFile = (id: string, fileId: string, name: string): Promise<{ ok: true; path: string }> => post(`/tasks/${encodeURIComponent(id)}/files`, { fileId, name });
export const listOutputs = (id: string): Promise<{ files: OutputFile[] }> => call(`/tasks/${encodeURIComponent(id)}/outputs`);

export async function uploadFile(file: File): Promise<{ id: string; name: string; size: number }> {
  const form = new FormData();
  form.append('file', file, file.name);
  const h = headers();
  let res: Response;
  try {
    res = await fetch(`${COWORK_BASE}/upload`, { method: 'POST', headers: h, body: form });
  } catch {
    throw new CoworkError(0, 'network');
  }
  const body = (await res.json().catch(() => ({}))) as { file?: { id: string; name: string; size: number }; error?: string; message?: string };
  if (!res.ok || !body.file) throw new CoworkError(res.status, body.error ?? `http_${res.status}`, body.message);
  return body.file;
}

/** Saves an output file (the download needs the session token, so it goes through a blob). */
export async function downloadOutput(f: Pick<OutputFile, 'id' | 'name'>): Promise<void> {
  const res = await fetch(`${COWORK_BASE}/files/${encodeURIComponent(f.id)}?name=${encodeURIComponent(f.name)}`, { headers: headers() });
  if (!res.ok) throw new CoworkError(res.status, `http_${res.status}`);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = f.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Every event so far (all pages), oldest first. */
export async function taskHistory(id: string, signal?: AbortSignal): Promise<CoworkEvent[]> {
  const out: CoworkEvent[] = [];
  let page: string | null = null;
  for (let i = 0; i < 20; i++) {
    const r: { data?: CoworkEvent[]; next_page?: string | null } = await call(`/tasks/${encodeURIComponent(id)}/events${page ? `?page=${encodeURIComponent(page)}` : ''}`, { signal });
    out.push(...(Array.isArray(r.data) ? r.data : []));
    page = r.next_page ?? null;
    if (!page) break;
  }
  return out;
}

/** SSE blocks in, one event object per block out (event names, comments and heartbeats aside). */
export class EventParser {
  private buf = '';
  private decoder = new TextDecoder();

  push(chunk: Uint8Array | string): CoworkEvent[] {
    this.buf += typeof chunk === 'string' ? chunk : this.decoder.decode(chunk, { stream: true });
    this.buf = this.buf.replace(/\r\n/g, '\n');
    const out: CoworkEvent[] = [];
    let end: number;
    while ((end = this.buf.indexOf('\n\n')) >= 0) {
      const ev = parseBlock(this.buf.slice(0, end));
      this.buf = this.buf.slice(end + 2);
      if (ev) out.push(ev);
    }
    return out;
  }

  end(): CoworkEvent[] {
    const rest = this.buf + this.decoder.decode();
    this.buf = '';
    const ev = rest.trim() ? parseBlock(rest) : null;
    return ev ? [ev] : [];
  }
}

function parseBlock(block: string): CoworkEvent | null {
  const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).replace(/^ /, '')).join('\n');
  if (!data) return null;
  try {
    const v: unknown = JSON.parse(data);
    return v && typeof v === 'object' && typeof (v as { type?: unknown }).type === 'string' ? (v as CoworkEvent) : null;
  } catch {
    return null;
  }
}

/**
 * Opens the task's live stream. Resolves once the stream is connected (so a
 * message sent after it cannot be missed); `onEvent` gets each event, and
 * `done` settles when the stream ends or is aborted.
 */
export async function openStream(id: string, onEvent: (ev: CoworkEvent) => void, signal: AbortSignal): Promise<{ done: Promise<void> }> {
  let res: Response;
  try {
    res = await fetch(`${COWORK_BASE}/tasks/${encodeURIComponent(id)}/stream`, { headers: { ...headers(), accept: 'text/event-stream' }, signal });
  } catch (e) {
    if (signal.aborted) throw e;
    throw new CoworkError(0, 'network');
  }
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new CoworkError(res.status, body.error ?? `http_${res.status}`, body.message);
  }
  const reader = res.body.getReader();
  const parser = new EventParser();
  const done = (async () => {
    try {
      for (;;) {
        const { done: end, value } = await reader.read();
        if (end) break;
        for (const ev of parser.push(value)) onEvent(ev);
      }
      for (const ev of parser.end()) onEvent(ev);
    } catch {
      // Aborted, or the connection dropped: the view reconnects if the task is still working.
    }
  })();
  return { done };
}

/** "$1.25" from cents. */
export const dollars = (cents: number | null | undefined): string => (cents == null ? '–' : `$${(cents / 100).toFixed(2)}`);

/** What a refusal means for the owner, in a sentence. */
export function coworkNotice(e: unknown): string {
  const code = e instanceof AiError ? e.code : 'network';
  const detail = e instanceof CoworkError && e.detail ? ` (${e.detail})` : '';
  switch (code) {
    case 'model_locked': return 'Cowork isn’t open to this account.';
    case 'cowork_not_configured': return 'Cowork needs the Anthropic API key on the server (ANTHROPIC_API_KEY).';
    case 'signed_out': return 'Your sign-in has expired. Sign in again.';
    case 'too_large': return 'That file is too large (30 MB at most).';
    case 'too_long': return 'That message is too long.';
    case 'rate_limited': return 'Too many requests at once. Wait a moment and try again.';
    case 'network': return 'You seem to be offline. Check your connection and try again.';
    case 'not_found': return 'This task isn’t there any more.';
    default: return `Cowork couldn’t do that just now${detail}.`;
  }
}
