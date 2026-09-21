/**
 * Admin app-config store for Banner & Promotion and related settings. One generic
 * key→jsonb table (vinax_config, see supabase/schema.sql) with an allowlist
 * of keys, so a future section costs one entry here, not a new endpoint.
 *
 * The ADMIN reads/writes through this route (token-gated). Clients read the
 * published values through the public /api/appconfig route (cached, no auth).
 */
import { dbFailure, isAdminAsync, unauthorized, type AdminEnv } from '../../_lib/admin';
import { auditPrior, logAdminAudit } from '../../_lib/adminAudit';
import { validateAiControls } from '../../_lib/ai';
import { sbSelectResult, sbUpsert, supabaseConfigured, type SupabaseEnv } from '../../_lib/supabase';

type Env = AdminEnv & SupabaseEnv;

// v5.13.0: 'flags' (feature kill-switches, public), 'runbook' (operator notes,
// admin-only), 'trending-pins' (curated search chips, merged into the public
// trending list).
export const ALLOWED_KEYS = new Set([
  'home-layout',
  'banners', 'festival', 'status-note', 'flags', 'runbook', 'trending-pins',
  // v5.15.0 — client bundle keys (see _lib/clientConfig.ts) + server-side knobs
  'greeting', 'broadcast', 'search-synonyms', 'catalog-sources', 'language-order', 'ai-starters', 'ai-quick', 'support-faq', 'min-version', 'maintenance-window', 'ai-rules',
  // v5.16.0 — operator-entered model prices for the AI Cost panel (admin-only)
  'ai-prices',
  // 7.2.0 — backend-enforced AI emergency stop, feature switches and daily
  // spend caps (_lib/ai.ts). Admin-only; strictly validated below.
  'ai-controls',
]);

/**
 * Keys whose value is validated strictly before it is stored: a malformed
 * record is refused with 400 and the reason, never coerced. The stored value
 * is the validator's normalised copy.
 */
const VALIDATORS: Partial<Record<string, (value: unknown) => { ok: true; value: unknown } | { ok: false; error: string }>> = {
  'ai-controls': (value) => validateAiControls(value),
};
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
  if (!(await isAdminAsync(request, env))) return unauthorized();
  if (!supabaseConfigured(env)) return json({ configured: false, value: null });
  const key = new URL(request.url).searchParams.get('key') ?? '';
  if (!ALLOWED_KEYS.has(key)) return json({ error: 'unknown_key' }, 400);
  const read = await sbSelectResult<ConfigRow>(env, 'vinax_config', `key=eq.${encodeURIComponent(key)}&select=key,value,updated_at&limit=1`);
  // 7.2.0 — a failed read must not look like "nothing published yet": an
  // editor opened on `value: null` shows defaults, and pressing Publish would
  // overwrite the real stored value with them.
  if (!read.ok) return dbFailure(read, { key });
  const row = read.rows[0];
  return json({ configured: true, value: row?.value ?? null, updated_at: row?.updated_at ?? null });
};

export const onRequestPost = async (context: { request: Request; env: Env; waitUntil?: (p: Promise<unknown>) => void }): Promise<Response> => {
  const { request, env } = context;
  if (!(await isAdminAsync(request, env))) return unauthorized();
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
  const validate = VALIDATORS[key];
  let value: unknown = body.value;
  if (validate) {
    const checked = validate(body.value);
    if (!checked.ok) return json({ error: 'invalid_value', key, reason: checked.error }, 400);
    value = checked.value;
  }
  const serialized = JSON.stringify(value);
  if (serialized.length > MAX_VALUE_BYTES) return json({ error: 'too_large' }, 413);
  // 7.2.0 — the stored value just before the write, for the audit row.
  const prior = await sbSelectResult<{ value: unknown }>(env, 'vinax_config', `key=eq.${encodeURIComponent(key)}&select=value&limit=1`);
  const ok = await sbUpsert(env, 'vinax_config', { key, value, updated_at: new Date().toISOString() }, 'key');
  if (!ok) return json({ error: 'store_failed' }, 502);
  await logAdminAudit(context, {
    action: 'config',
    summary: `updated ${key} (${serialized.length} bytes)`,
    target: key,
    before: auditPrior(prior, (row) => row.value),
    after: value,
  });
  return json({ ok: true, ...(validate ? { value } : {}) });
};
