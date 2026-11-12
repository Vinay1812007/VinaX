/**
 * VinaX AI — Cowork's task routes (/api/ai/cowork/<path>; the list and
 * "new task" are ../cowork.ts). Every route: signed in, one of Claude's
 * accounts (claudeAccess.ts), ANTHROPIC_API_KEY set; a task id must be one
 * of Cowork's own sessions (metadata.app), so no other session on the key
 * can be read or driven from here.
 *
 *   POST   setup                              → { ok, created, updated }   (makes or updates the agent and environment)
 *   POST   upload        multipart "file"     → { file: { id, name, size } }   (≤ 30 MB; the bytes pass straight to Anthropic's Files API)
 *   GET    files/<file id>?name=<file name>   → the file (attachment)
 *   GET    tasks/<id>                         → { task }
 *   DELETE tasks/<id>                         → { ok }   (the person deleted it: history, workspace and outputs go)
 *   GET    tasks/<id>/stream                  → Anthropic's event stream, untouched (live text previews on)
 *   GET    tasks/<id>/events?page=<cursor>    → { data: [events], next_page }   (history, for a page that (re)opens a task)
 *   POST   tasks/<id>/events  { type: "message", text } | { type: "interrupt" }
 *                             | { type: "confirm", toolUseId, allow, denyMessage? }   → { ok }
 *   POST   tasks/<id>/budget  { cents }       → { task }   (a new cap; resumes a task paused at its cap)
 *   POST   tasks/<id>/files   { fileId, name } → { ok, path }   (adds an uploaded file to a running task)
 *   GET    tasks/<id>/outputs                 → { files: [{ id, name, size, mime, createdAt }] }   (what it saved to /mnt/session/outputs/)
 *
 * Refusals: 400 bad_request · 401 signed_out · 403 model_locked · 404 not_found
 * · 413 too_large · 502 upstream { status, message? } · 503 cowork_not_configured | unavailable.
 */
import { CORS, json } from '../../../_lib/authShared';
import { readJsonCapped } from '../../../_lib/body';
import {
  clampBudget, ensureSetup, EVENT_ID, FILE_ID, isCoworkSession, MA_BASE, maError, maHeaders, maJson, MAX_MESSAGE_CHARS, MAX_UPLOAD_BYTES,
  safeFileName, SESSION_ID, sessionSummary, userMessage,
} from '../../../_lib/ai/cowork';
import { coworkGate } from '../cowork';
import type { AiEnv } from '../../../_lib/ai/types';

interface Ctx {
  request: Request;
  env: AiEnv;
  params?: Record<string, unknown>;
  waitUntil?: (p: Promise<unknown>) => void;
}

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: { ...CORS, 'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS' } });

const notFound = (): Response => json({ error: 'not_found' }, 404);
const bad = (): Response => json({ error: 'bad_request' }, 400);

function segments(ctx: Ctx): string[] {
  const p = ctx.params?.path;
  return typeof p === 'string' ? p.split('/').filter(Boolean) : [];
}

/** Sessions this isolate has already checked are Cowork's. */
const known = new Set<string>();

/** The task, when the id is one of Cowork's sessions; else a 404 (or the upstream failure). */
async function task(env: AiEnv, id: string | undefined): Promise<{ raw: Record<string, unknown> | null } | Response> {
  if (!id || !SESSION_ID.test(id)) return notFound();
  if (known.has(id)) return { raw: null };
  const r = await maJson(env, `/sessions/${id}`);
  if (r.status === 404) return notFound();
  if (!r.ok) return json(maError(r), 502);
  if (!isCoworkSession(r.body)) return notFound();
  if (known.size > 500) known.clear();
  known.add(id);
  return { raw: r.body };
}

async function fullTask(env: AiEnv, id: string): Promise<Response> {
  const r = await maJson(env, `/sessions/${id}`);
  if (!r.ok) return json(maError(r), r.status === 404 ? 404 : 502);
  return json({ task: sessionSummary(r.body) });
}

function parseObject(text: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(text);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const passHeaders = (contentType: string): Record<string, string> => ({ 'content-type': contentType, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...CORS });

/** Anthropic's own bytes, handed on (the Worker never reads them: free-plan CPU). */
async function pass(env: AiEnv, path: string, init: { signal?: AbortSignal; accept?: string } = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${MA_BASE}${path}`, { headers: { ...maHeaders(env, true, false), accept: init.accept ?? 'application/json' }, signal: init.signal });
  } catch {
    return json({ error: 'network', status: 0 }, 502);
  }
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    return json(maError({ ok: false, status: res.status, body: parseObject(text) }), res.status === 404 ? 404 : 502);
  }
  return new Response(res.body, { status: 200, headers: passHeaders(res.headers.get('content-type') ?? 'application/json') });
}

export const onRequestGet = async (ctx: Ctx): Promise<Response> => {
  const gate = await coworkGate(ctx, 'ai-cowork-read', 240);
  if (gate instanceof Response) return gate;
  const { env, request } = ctx;
  const [head, id, sub, extra] = segments(ctx);
  if (head === 'files' && id && !sub) {
    if (!FILE_ID.test(id)) return notFound();
    const name = safeFileName(new URL(request.url).searchParams.get('name'), 'download');
    let res: Response;
    try {
      res = await fetch(`${MA_BASE}/files/${id}/content`, { headers: maHeaders(env, true, false), signal: request.signal });
    } catch {
      return json({ error: 'network', status: 0 }, 502);
    }
    if (!res.ok || !res.body) return json({ error: res.status === 404 ? 'not_found' : 'upstream', status: res.status }, res.status === 404 ? 404 : 502);
    return new Response(res.body, {
      status: 200,
      headers: {
        'content-type': res.headers.get('content-type') ?? 'application/octet-stream',
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
        'content-security-policy': "default-src 'none'; sandbox",
        'x-content-type-options': 'nosniff',
        'cache-control': 'private, no-store',
        ...CORS,
      },
    });
  }
  if (head !== 'tasks' || extra) return notFound();
  const t = await task(env, id);
  if (t instanceof Response) return t;
  if (!sub) return t.raw ? json({ task: sessionSummary(t.raw) }) : fullTask(env, id);
  if (sub === 'stream') {
    // Live previews of the agent's text; the stream lasts until the page goes away.
    return pass(env, `/sessions/${id}/events/stream?event_deltas[]=agent.message`, { signal: request.signal, accept: 'text/event-stream' });
  }
  if (sub === 'events') {
    const page = new URL(request.url).searchParams.get('page');
    if (page != null && !/^[A-Za-z0-9_=-]{1,512}$/.test(page)) return bad();
    return pass(env, `/sessions/${id}/events?limit=1000${page ? `&page=${encodeURIComponent(page)}` : ''}`, { signal: request.signal });
  }
  if (sub === 'outputs') {
    const r = await maJson<{ data?: unknown[] }>(env, `/files?scope_id=${id}&limit=100`);
    if (!r.ok) return json(maError(r), 502);
    const files = (Array.isArray(r.body.data) ? r.body.data : []).map((f) => {
      const o = f as Record<string, unknown>;
      return typeof o.id === 'string' && FILE_ID.test(o.id)
        ? { id: o.id, name: safeFileName(o.filename, o.id), size: Number(o.size_bytes) || 0, mime: typeof o.mime_type === 'string' ? o.mime_type : null, createdAt: typeof o.created_at === 'string' ? o.created_at : null }
        : null;
    }).filter(Boolean);
    return json({ files });
  }
  return notFound();
};

export const onRequestPost = async (ctx: Ctx): Promise<Response> => {
  const gate = await coworkGate(ctx, 'ai-cowork-write', 60);
  if (gate instanceof Response) return gate;
  const { env, request } = ctx;
  const [head, id, sub, extra] = segments(ctx);

  if (head === 'setup' && !id) {
    const r = await ensureSetup(env);
    if (!r.ok) return json(r.failure ? { ...maError(r.failure), step: r.step } : { error: 'unavailable' }, r.failure ? 502 : 503);
    return json({ ok: true, created: r.created, updated: r.updated });
  }

  if (head === 'upload' && !id) {
    const type = request.headers.get('content-type') ?? '';
    if (!/^multipart\/form-data;\s*boundary=/i.test(type)) return bad();
    const length = Number(request.headers.get('content-length'));
    if (!Number.isFinite(length) || length <= 0) return json({ error: 'length_required' }, 411);
    if (length > MAX_UPLOAD_BYTES + 64 * 1024) return json({ error: 'too_large' }, 413);
    let res: Response;
    try {
      // The multipart body goes on as it came: the Worker never reads the file.
      res = await fetch(`${MA_BASE}/files`, { method: 'POST', headers: { ...maHeaders(env, false, false), 'content-type': type, 'content-length': String(length) }, body: request.body, duplex: 'half' } as RequestInit);
    } catch {
      return json({ error: 'network', status: 0 }, 502);
    }
    const text = await res.text().catch(() => '');
    const body = parseObject(text);
    if (!res.ok || typeof body.id !== 'string' || !FILE_ID.test(body.id)) return json(maError({ ok: false, status: res.status, body }), res.status === 413 ? 413 : 502);
    return json({ file: { id: body.id, name: safeFileName(body.filename, body.id), size: Number(body.size_bytes) || 0 } });
  }

  if (head !== 'tasks' || !sub || extra) return notFound();
  const t = await task(env, id);
  if (t instanceof Response) return t;
  const read = await readJsonCapped<Record<string, unknown> | null>(request, MAX_MESSAGE_CHARS * 4 + 4_096);
  if (!read.ok) return json({ error: read.reason === 'too_large' ? 'too_large' : 'bad_request' }, read.reason === 'too_large' ? 413 : 400);
  const b = read.value && typeof read.value === 'object' ? read.value : {};

  if (sub === 'events') {
    let event: Record<string, unknown>;
    if (b.type === 'message') {
      const text = typeof b.text === 'string' ? b.text.trim() : '';
      if (!text) return bad();
      if (text.length > MAX_MESSAGE_CHARS) return json({ error: 'too_long' }, 413);
      event = userMessage(text);
    } else if (b.type === 'interrupt') {
      event = { type: 'user.interrupt' };
    } else if (b.type === 'confirm') {
      if (typeof b.toolUseId !== 'string' || !EVENT_ID.test(b.toolUseId) || typeof b.allow !== 'boolean') return bad();
      const deny = typeof b.denyMessage === 'string' ? b.denyMessage.trim().slice(0, 2_000) : '';
      event = { type: 'user.tool_confirmation', tool_use_id: b.toolUseId, result: b.allow ? 'allow' : 'deny', ...(!b.allow && deny ? { deny_message: deny } : {}) };
    } else return bad();
    const r = await maJson(env, `/sessions/${id}/events`, { method: 'POST', body: { events: [event] } });
    if (!r.ok) return json(maError(r), r.status === 400 ? 409 : 502);
    return json({ ok: true });
  }

  if (sub === 'budget') {
    if (b.cents == null) return bad();
    const cents = clampBudget(b.cents);
    const r = await maJson(env, `/sessions/${id}`, { method: 'POST', body: { budget: { type: 'limit', max_list_cost: { amount: String(cents), currency: 'USD' } } } });
    if (!r.ok) return json(maError(r), r.status === 400 ? 409 : 502);
    return json({ task: sessionSummary(r.body) });
  }

  if (sub === 'files') {
    if (typeof b.fileId !== 'string' || !FILE_ID.test(b.fileId)) return bad();
    const name = safeFileName(b.name, b.fileId);
    const mount = `/${name}`;
    const r = await maJson(env, `/sessions/${id}/resources`, { method: 'POST', body: { type: 'file', file_id: b.fileId, mount_path: mount } });
    if (!r.ok) return json(maError(r), 502);
    return json({ ok: true, path: `/mnt/session/uploads${mount}` });
  }
  return notFound();
};

export const onRequestDelete = async (ctx: Ctx): Promise<Response> => {
  const gate = await coworkGate(ctx, 'ai-cowork-write', 60);
  if (gate instanceof Response) return gate;
  const [head, id, sub] = segments(ctx);
  if (head !== 'tasks' || sub) return notFound();
  const t = await task(ctx.env, id);
  if (t instanceof Response) return t;
  // A running task cannot be deleted: stop it first (the page interrupts, then deletes).
  const r = await maJson(ctx.env, `/sessions/${id}`, { method: 'DELETE' });
  if (!r.ok && r.status !== 404) return json(maError(r), r.status === 400 ? 409 : 502);
  known.delete(id!);
  console.log(JSON.stringify({ route: 'ai-cowork', deleted: id }));
  return json({ ok: true });
};
