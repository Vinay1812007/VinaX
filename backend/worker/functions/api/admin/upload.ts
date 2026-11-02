/**
 * Version 8 — POST /api/admin/upload { data: "data:image/jpeg;base64,…", purpose: "banner" | "notification" | "other" }
 *   → { ok, url, path }
 *
 * A picture the console cropped and resized in the browser, stored in the
 * public Storage bucket `console-media` so the app can show it. PNG, JPEG or
 * WebP only, at most 1.5 MB after decoding. Editors and owners.
 */
import { adminJson, badRequest } from '../../_lib/admin';
import { adminPost } from '../../_lib/adminRoute';
import { dbConfigured } from '../../_lib/db';

export const MEDIA_BUCKET = 'console-media';
const MAX_BYTES = 1_500_000;
const TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

export const onRequestPost = adminPost(async ({ env, body, audit }) => {
  if (!dbConfigured(env)) return adminJson({ error: 'db_not_configured' }, 503);
  const m = typeof body.data === 'string' ? /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(body.data) : null;
  if (!m) return badRequest('bad_image');
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    const bin = atob(m[2]);
    bytes = new Uint8Array(new ArrayBuffer(bin.length));
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch {
    return badRequest('bad_image');
  }
  if (bytes.length > MAX_BYTES) return adminJson({ error: 'too_large' }, 413);
  const purpose = body.purpose === 'banner' || body.purpose === 'notification' ? body.purpose : 'other';
  const path = `${purpose}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${TYPES[m[1]]}`;
  const base = `${String(env.SUPABASE_URL).trim().replace(/\/+$/, '')}/storage/v1/object`;
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY).trim();
  let ok = false;
  try {
    const res = await fetch(`${base}/${MEDIA_BUCKET}/${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, apikey: key, 'content-type': m[1], 'x-upsert': 'false', 'cache-control': 'public, max-age=31536000, immutable' },
      body: bytes,
      signal: AbortSignal.timeout(20_000),
    });
    await res.body?.cancel().catch(() => undefined);
    ok = res.ok;
  } catch {
    ok = false;
  }
  if (!ok) return adminJson({ error: 'upload_failed' }, 502);
  const url = `${base}/public/${MEDIA_BUCKET}/${path}`;
  await audit({ action: 'media-upload', summary: `uploaded a ${purpose} picture (${Math.round(bytes.length / 1024)} KB)`, target: path });
  return adminJson({ ok: true, url, path });
}, { cap: 2_200_000 });
