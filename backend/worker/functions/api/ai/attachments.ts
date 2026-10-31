/**
 * VinaX AI — POST /api/ai/attachments?name=<file name>&conversationId=<uuid>
 * adds a file to a chat (before or in a conversation).
 *
 *   body: the file's bytes, sent as they are (not multipart), with its
 *   Content-Type and Content-Length. The Worker checks the type, the size
 *   and the first bytes, then streams the file into the private Storage
 *   bucket without buffering it (text files, at most 1 MB, are read whole:
 *   their text is kept for the model).
 *
 *   → 200 { id, name, mime, size, kind }
 *   → 400 bad_request · 401 signed_out · 404 not_found (conversation) · 409 too_many_files
 *   → 411 length_required · 413 too_large · 415 unsupported_type
 *   → 429 rate_limited · 503 ai_disabled | unavailable
 *
 * A PDF's text, read on the device, follows with PATCH /api/ai/attachments/:id.
 */
import { bearer, readSession } from '../../_lib/googleAuth';
import { CORS, json } from '../../_lib/authShared';
import { readCapped } from '../../_lib/body';
import { rateLimitAsync } from '../../_lib/ratelimit';
import { db, dbConfigured, q } from '../../_lib/db';
import { aiOpenFor, aiSettings } from '../../_lib/ai/config';
import { cleanName, kindOf, maxBytes, MAX_EXTRACTED_CHARS, MAX_FILES_PER_CONVERSATION, sniff, type AttachmentKind } from '../../_lib/ai/attachments';
import { storagePut, storageRemove } from '../../_lib/ai/storage';
import { getConversation, isUuid } from '../../_lib/ai/store';
import type { AiEnv } from '../../_lib/ai/types';

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: { ...CORS, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': `${CORS['access-control-allow-headers']}, content-length` } });

/** The body with its first bytes checked, its length held to `length`. */
async function checkedStream(body: ReadableStream<Uint8Array>, length: number, kind: AttachmentKind, mime: string): Promise<{ ok: true; stream: ReadableStream<Uint8Array> } | { ok: false; error: 'unsupported_type' | 'too_large' }> {
  const reader = body.getReader();
  const head: Uint8Array[] = [];
  let got = 0;
  while (got < 16) {
    const { done, value } = await reader.read();
    if (done) break;
    head.push(value);
    got += value.length;
  }
  const first = new Uint8Array(got);
  let o = 0;
  for (const c of head) { first.set(c, o); o += c.length; }
  if (!sniff(kind, mime, first)) {
    await reader.cancel().catch(() => undefined);
    return { ok: false, error: 'unsupported_type' };
  }
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      sent += first.length;
      if (sent > length) c.error(new Error('too_large'));
      else c.enqueue(first);
    },
    async pull(c) {
      const { done, value } = await reader.read();
      if (done) { c.close(); return; }
      sent += value.length;
      if (sent > length) { c.error(new Error('too_large')); await reader.cancel().catch(() => undefined); return; }
      c.enqueue(value);
    },
    cancel() { void reader.cancel().catch(() => undefined); },
  });
  return { ok: true, stream };
}

export const onRequestPost = async (ctx: { request: Request; env: AiEnv }): Promise<Response> => {
  const { request, env } = ctx;
  const limited = await rateLimitAsync(request, 'ai-attachments', { capacity: 20, refillPerMinute: 20 }, env);
  if (limited) return limited;
  const sub = await readSession(env, bearer(request));
  if (!sub) return json({ error: 'signed_out' }, 401);
  if (!dbConfigured(env)) return json({ error: 'unavailable' }, 503);
  if (!aiOpenFor(await aiSettings(env), sub)) return json({ error: 'ai_disabled' }, 503);

  const url = new URL(request.url);
  const name = cleanName(url.searchParams.get('name'));
  const convParam = url.searchParams.get('conversationId');
  if (convParam && !isUuid(convParam)) return json({ error: 'bad_request' }, 400);
  const mime = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const kind = kindOf(mime, name);
  if (!kind) return json({ error: 'unsupported_type' }, 415);
  const length = Number(request.headers.get('content-length'));
  if (!Number.isFinite(length) || length <= 0) return json({ error: 'length_required' }, 411);
  if (length > maxBytes(kind)) return json({ error: 'too_large' }, 413);
  if (!request.body) return json({ error: 'bad_request' }, 400);

  if (convParam) {
    const c = await getConversation(env, sub, convParam);
    if (!c.ok) return json({ error: 'unavailable' }, 503);
    if (!c.value) return json({ error: 'not_found' }, 404);
    const have = await db.count(env, 'ai_attachments', q().eq('conversation_id', convParam));
    if (have.ok && have.value >= MAX_FILES_PER_CONVERSATION) return json({ error: 'too_many_files' }, 409);
  }

  const id = crypto.randomUUID();
  const path = `${sub}/${convParam ?? 'new'}/${id}`;
  let extracted: string | null = null;
  let stored: boolean;
  if (kind === 'text') {
    const bytes = await readCapped(request.body, maxBytes(kind));
    if (!bytes) return json({ error: 'too_large' }, 413);
    if (!sniff(kind, mime, bytes)) return json({ error: 'unsupported_type' }, 415);
    extracted = new TextDecoder('utf-8').decode(bytes).slice(0, MAX_EXTRACTED_CHARS);
    // Stored as plain text whatever the code type: the bucket only takes known types.
    stored = await storagePut(env, path, new Uint8Array(bytes), 'text/plain; charset=utf-8', bytes.length);
  } else {
    const checked = await checkedStream(request.body, length, kind, mime);
    if (!checked.ok) return json({ error: checked.error }, checked.error === 'too_large' ? 413 : 415);
    stored = await storagePut(env, path, checked.stream, mime, length);
  }
  if (!stored) return json({ error: 'unavailable' }, 503);

  const size = kind === 'text' && extracted != null ? new TextEncoder().encode(extracted).length : length;
  const row = { id, account_id: sub, conversation_id: convParam, name, mime: kind === 'text' ? mime || 'text/plain' : mime, size, kind, storage_path: path, extracted_text: extracted };
  const saved = await db.insert(env, 'ai_attachments', row);
  if (!saved.ok) {
    await storageRemove(env, [path]);
    return json({ error: 'unavailable' }, 503);
  }
  return json({ id, name, mime: row.mime, size, kind });
};
