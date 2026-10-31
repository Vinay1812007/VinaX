/**
 * VinaX AI — one file of the signed-in listener.
 *
 *   GET    /api/ai/attachments/<id>   → the file (the page shows images and offers downloads)
 *   PATCH  /api/ai/attachments/<id>   { text, pages }  a PDF's text, read on the device, for models
 *                                     that cannot read PDFs → 200 { ok } · 413 too_many_pages
 *   DELETE /api/ai/attachments/<id>   a file not sent yet (the × on a chip) → 200 { ok } · 409 in_use
 *   → 401 signed_out · 404 not_found (missing or someone else's) · 503 unavailable
 *
 * A file is served with its own type, nosniff and a sandboxing CSP, as an
 * attachment unless it is an image, so nothing stored can run as a page of
 * this site.
 */
import { bearer, readSession } from '../../../_lib/googleAuth';
import { CORS, json } from '../../../_lib/authShared';
import { readJsonCapped } from '../../../_lib/body';
import { rateLimitAsync } from '../../../_lib/ratelimit';
import { db, dbConfigured, q } from '../../../_lib/db';
import { ATT_COLS, MAX_EXTRACTED_CHARS, MAX_PDF_PAGES, type AttachmentRow } from '../../../_lib/ai/attachments';
import { storageGet, storageRemove } from '../../../_lib/ai/storage';
import { isUuid } from '../../../_lib/ai/store';
import type { AiEnv } from '../../../_lib/ai/types';

interface Ctx { request: Request; env: AiEnv; params?: { id?: string } }

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: { ...CORS, 'access-control-allow-methods': 'GET, PATCH, DELETE, OPTIONS' } });

async function owned(ctx: Ctx, route: string, capacity = 60): Promise<{ sub: string; row: AttachmentRow } | Response> {
  const limited = await rateLimitAsync(ctx.request, route, { capacity, refillPerMinute: capacity }, ctx.env);
  if (limited) return limited;
  const sub = await readSession(ctx.env, bearer(ctx.request));
  if (!sub) return json({ error: 'signed_out' }, 401);
  if (!dbConfigured(ctx.env)) return json({ error: 'unavailable' }, 503);
  const id = ctx.params?.id;
  if (!isUuid(id)) return json({ error: 'not_found' }, 404);
  const r = await db.one<AttachmentRow>(ctx.env, 'ai_attachments', q().eq('id', id).eq('account_id', sub).select(ATT_COLS));
  if (!r.ok) return json({ error: 'unavailable' }, 503);
  if (!r.value) return json({ error: 'not_found' }, 404);
  return { sub, row: r.value };
}

export const onRequestGet = async (ctx: Ctx): Promise<Response> => {
  const o = await owned(ctx, 'ai-attachment', 120);
  if (o instanceof Response) return o;
  const file = await storageGet(ctx.env, o.row.storage_path);
  if (!file?.body) return json({ error: 'unavailable' }, 503);
  const inline = o.row.kind === 'image';
  const mime = o.row.kind === 'text' ? 'text/plain; charset=utf-8' : o.row.mime;
  return new Response(file.body, {
    status: 200,
    headers: {
      'content-type': mime,
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(o.row.name)}`,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'cache-control': 'private, max-age=3600',
      ...CORS,
    },
  });
};

export const onRequestPatch = async (ctx: Ctx): Promise<Response> => {
  const o = await owned(ctx, 'ai-attachment-write', 30);
  if (o instanceof Response) return o;
  if (o.row.kind !== 'pdf') return json({ error: 'bad_request' }, 400);
  const read = await readJsonCapped<{ text?: unknown; pages?: unknown } | null>(ctx.request, MAX_EXTRACTED_CHARS * 4 + 1_024);
  if (!read.ok) return json({ error: read.reason === 'too_large' ? 'too_large' : 'bad_request' }, read.reason === 'too_large' ? 413 : 400);
  const pages = Number(read.value?.pages);
  if (!Number.isInteger(pages) || pages < 1) return json({ error: 'bad_request' }, 400);
  if (pages > MAX_PDF_PAGES) return json({ error: 'too_many_pages' }, 413);
  const text = typeof read.value?.text === 'string' ? read.value.text.slice(0, MAX_EXTRACTED_CHARS) : '';
  const r = await db.update(ctx.env, 'ai_attachments', q().eq('id', o.row.id).eq('account_id', o.sub), { extracted_text: text || null, pages });
  return r.ok ? json({ ok: true }) : json({ error: 'unavailable' }, 503);
};

export const onRequestDelete = async (ctx: Ctx): Promise<Response> => {
  const o = await owned(ctx, 'ai-attachment-write', 30);
  if (o instanceof Response) return o;
  // A file already sent in a conversation stays with it.
  if (o.row.conversation_id) return json({ error: 'in_use' }, 409);
  await storageRemove(ctx.env, [o.row.storage_path]);
  const r = await db.remove(ctx.env, 'ai_attachments', q().eq('id', o.row.id).eq('account_id', o.sub));
  return r.ok ? json({ ok: true }) : json({ error: 'unavailable' }, 503);
};
