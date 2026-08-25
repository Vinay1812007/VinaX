/**
 * Admin app-config store — the backend Banner & Promotion and Home Screen
 * Management were stubbed against ("TODO: wire GET/PUT"). One generic
 * key→jsonb table (vinax_config, see supabase/schema.sql) with an allowlist
 * of keys, so a future section costs one entry here, not a new endpoint.
 *
 * The ADMIN reads/writes through this route (token-gated). Clients read the
 * published values through the public /api/appconfig route (cached, no auth).
 */
import { isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';
import { logAdminAudit } from '../../_lib/adminAudit';
import { sbSelect, sbUpsert, supabaseConfigured, type SupabaseEnv } from '../../_lib/supabase';

type Env = AdminEnv & SupabaseEnv;

export const ALLOWED_KEYS = new Set(['banners', 'home-config', 'festival']);
/** jsonb payload cap — banners may embed small base64 images. */
const MAX_VALUE_BYTES = 900 * 1024;

const json = (o: unknown, status = 200): Response =>
  new Response(JSON.stringify(o), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

interface ConfigRow {
  key: string;
  value: unknown;
  updated_at: string;
}

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!isAdmin(request, env)) return unauthorized();
  if (!supabaseConfigured(env)) return json({ configured: false, value: null });
  const key = new URL(request.url).searchParams.get('key') ?? '';
  if (!ALLOWED_KEYS.has(key)) return json({ error: 'unknown_key' }, 400);
  const rows = await sbSelect<ConfigRow>(env, 'vinax_config', `key=eq.${encodeURIComponent(key)}&select=key,value,updated_at&limit=1`).catch(
    () => [] as ConfigRow[],
  );
  const row = rows[0];
  return json({ configured: true, value: row?.value ?? null, updated_at: row?.updated_at ?? null });
};

export const onRequestPost = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!isAdmin(request, env)) return unauthorized();
  if (!supabaseConfigured(env)) return json({ error: 'not_configured' }, 503);
  let body: { key?: unknown; value?: unknown };
  try {
    body = (await request.json()) as { key?: unknown; value?: unknown };
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  const key = typeof body.key === 'string' ? body.key : '';
  if (!ALLOWED_KEYS.has(key)) return json({ error: 'unknown_key' }, 400);
  if (body.value === undefined) return json({ error: 'bad_request' }, 400);
  const serialized = JSON.stringify(body.value);
  if (serialized.length > MAX_VALUE_BYTES) return json({ error: 'too_large' }, 413);
  const ok = await sbUpsert(env, 'vinax_config', { key, value: body.value, updated_at: new Date().toISOString() }, 'key');
  if (!ok) return json({ error: 'store_failed' }, 502);
  void logAdminAudit(env, 'config', `updated ${key} (${serialized.length} bytes)`);
  return json({ ok: true });
};
