/**
 * Admin: Environment Checklist (v5.15.0).
 *   GET /api/admin/envcheck → { items:[{name,group,set,required,note}], missingRequired }
 * Names only — values never leave the Worker. Tells the operator which
 * secrets/vars are configured so a half-set deployment is obvious.
 */
import { isAdminAsync, unauthorized, type AdminEnv } from '../../_lib/admin';

type Env = AdminEnv & Record<string, unknown>;

const json = (o: unknown, status = 200): Response =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export const ENV_ITEMS: Array<{ name: string; group: string; required: boolean; note: string }> = [
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
  // 10.3 — the four AI keys, one per provider. A key that was never pasted
  // into Cloudflare shows up here instead of silently degrading every lane on
  // it through the failover ladder.
  { name: 'VINAX_NVIDIA_API_KEY', group: 'AI', required: false, note: 'NVIDIA — dj, chat, deep, fast, home, search, pro, mini and vision lanes + its free catalogue + embeddings + images' },
  { name: 'VINAX_OPENROUTER_API_KEY', group: 'AI', required: false, note: 'OpenRouter — router lane + its zero-priced catalogue' },
  { name: 'VINAX_GROQ_API_KEY', group: 'AI', required: false, note: 'Groq — scholar lane, live voice, TTS + its free catalogue' },
  { name: 'VINAX_GGL_GEMINI_API_KEY', group: 'AI', required: false, note: 'Gemini — maestro (flagship) lane + its free catalogue + embeddings' },
  { name: 'VINAX_MAESTRO_MODEL', group: 'AI', required: false, note: 'optional model name that replaces the maestro pin (never a key)' },
  { name: 'ASSETS_HOST', group: 'Edge', required: true, note: 'Pages origin the Worker proxies' },
  { name: 'HANDOFF', group: 'Edge', required: true, note: 'KV namespace for device handoff' },
  { name: 'NOTIFY_MIN_GAP_HOURS', group: 'Push', required: false, note: 'push frequency cap' },
];

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!(await isAdminAsync(request, env))) return unauthorized();
  const items = ENV_ITEMS.map((i) => {
    const v = env[i.name];
    const set = v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '');
    return { ...i, set };
  });
  return json({ items, missingRequired: items.filter((i) => i.required && !i.set).map((i) => i.name), checkedAt: new Date().toISOString() });
};
