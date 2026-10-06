/**
 * Admin: Environment Checklist (v5.15.0).
 *   GET /api/admin/envcheck → { items:[{name,group,set,required,note}], missingRequired }
 * Names only — values never leave the Worker. Tells the operator which
 * secrets/vars are configured so a half-set deployment is obvious.
 *
 * 10.3 — the four AI keys are listed by their PRIMARY names. Each item also
 * carries `fallback` (the previous name) and `usingFallback`: true when the
 * key is only set under the previous name, which still works during the
 * switch (and the note says to rename it).
 */
import { isAdminAsync, unauthorized, type AdminEnv } from '../../_lib/admin';
import { PROVIDER_ENV, PROVIDER_ENV_FALLBACK } from '../../_lib/ai';

type Env = AdminEnv & Record<string, unknown>;

const json = (o: unknown, status = 200): Response =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export const ENV_ITEMS: Array<{ name: string; group: string; required: boolean; note: string; fallback?: string }> = [
  { name: 'ADMIN_LOGIN_PASSWORD', group: 'Admin', required: true, note: 'console login' },
  { name: 'SUPABASE_URL', group: 'Data', required: true, note: 'analytics + config store' },
  { name: 'SUPABASE_SERVICE_ROLE_KEY', group: 'Data', required: true, note: 'server-side Supabase writes' },
  { name: 'DEVICE_ID_SECRET', group: 'Data', required: true, note: 'signed device ids for telemetry' },
  { name: 'TELEMETRY_PEPPER', group: 'Data', required: false, note: 'device id hashing (falls back to DEVICE_ID_SECRET)' },
  { name: 'CRON_SECRET', group: 'Cron', required: true, note: 'GitHub Actions → cron endpoints' },
  { name: 'VAPID_PUBLIC_KEY', group: 'Push', required: false, note: 'web push' },
  { name: 'VAPID_PRIVATE_KEY', group: 'Push', required: false, note: 'web push' },
  { name: 'VAPID_SUBJECT', group: 'Push', required: false, note: 'web push contact' },
  { name: 'FCM_SERVICE_ACCOUNT', group: 'Push', required: false, note: 'Android push (FCM v1)' },
  { name: 'GITHUB_TOKEN', group: 'Releases', required: false, note: 'APK release proxy + Releases & CI panel' },
  { name: 'GITHUB_REPO', group: 'Releases', required: false, note: 'owner/repo for releases' },
  { name: 'NVIDIA_BASE_URL', group: 'AI', required: false, note: 'provider base override' },
  // 10.3 — the four AI keys, one per provider, by their primary names; the
  // previous name of each still works while the primary is unset. A key that
  // was never pasted into Cloudflare shows up here instead of silently
  // degrading every lane on it through the failover ladder.
  { name: PROVIDER_ENV.nvidia, fallback: PROVIDER_ENV_FALLBACK.nvidia, group: 'AI', required: false, note: 'NVIDIA — dj, chat, deep, fast, home, search, pro, mini and vision lanes + its free catalogue + embeddings + images' },
  { name: PROVIDER_ENV.openrouter, fallback: PROVIDER_ENV_FALLBACK.openrouter, group: 'AI', required: false, note: 'OpenRouter — router lane + its zero-priced catalogue and free media models' },
  { name: PROVIDER_ENV.groq, fallback: PROVIDER_ENV_FALLBACK.groq, group: 'AI', required: false, note: 'Groq — scholar lane, live voice, TTS, transcription, code execution + its free catalogue' },
  { name: PROVIDER_ENV.gemini, fallback: PROVIDER_ENV_FALLBACK.gemini, group: 'AI', required: false, note: 'Gemini — maestro (flagship) lane + its free catalogue + embeddings, TTS, transcription, code execution' },
  { name: 'VINAX_MAESTRO_MODEL', group: 'AI', required: false, note: 'optional model name that replaces the maestro pin (never a key)' },
  { name: 'ASSETS_HOST', group: 'Edge', required: true, note: 'Pages origin the Worker proxies' },
  { name: 'HANDOFF', group: 'Edge', required: true, note: 'KV namespace for device handoff' },
  { name: 'NOTIFY_MIN_GAP_HOURS', group: 'Push', required: false, note: 'push frequency cap' },
];

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!(await isAdminAsync(request, env))) return unauthorized();
  const isSet = (name: string): boolean => {
    const v = env[name];
    return v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '');
  };
  const items = ENV_ITEMS.map((i) => {
    const primary = isSet(i.name);
    if (!i.fallback) return { ...i, set: primary };
    // 10.3 — names only: which of the two names supplies the key, never its value.
    const usingFallback = !primary && isSet(i.fallback);
    return { ...i, set: primary || usingFallback, usingFallback, ...(usingFallback ? { note: `${i.note} — set under the previous name ${i.fallback}; rename it to ${i.name}` } : {}) };
  });
  return json({ items, missingRequired: items.filter((i) => i.required && !i.set).map((i) => i.name), checkedAt: new Date().toISOString() });
};
