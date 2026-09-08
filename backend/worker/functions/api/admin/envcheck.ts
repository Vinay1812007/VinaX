/**
 * Admin: Environment Checklist (v5.15.0).
 *   GET /api/admin/envcheck → { items:[{name,group,set,required,note}], missingRequired }
 * Names only — values never leave the Worker. Tells the operator which
 * secrets/vars are configured so a half-set deployment is obvious.
 */
import { isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';

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
  { name: 'BRAVE_API_KEY', group: 'AI', required: false, note: 'live web search (keyless fallback otherwise)' },
  { name: 'NVIDIA_BASE_URL', group: 'AI', required: false, note: 'provider base override' },
  { name: 'VINAX_CHATGPT_120_B', group: 'AI', required: false, note: 'chat lane key' },
  { name: 'VINAX_CHATGPT_20_B', group: 'AI', required: false, note: 'fast lane key' },
  { name: 'VINAX_DEEPSEEK_V4_FLASH', group: 'AI', required: false, note: 'deep lane key' },
  { name: 'VINAX_NEMOTRON_SUPER', group: 'AI', required: false, note: 'pro lane key' },
  { name: 'VINAX_NEMOTRON_ULTRA', group: 'AI', required: false, note: 'ultra lane key' },
  { name: 'VINAX_NVIDIA_NEMOTRON_3_NANO_30B_A3B', group: 'AI', required: false, note: 'mini lane key' },
  { name: 'VINAX_GROQ_API_KEY', group: 'AI', required: false, note: 'scholar lane + TTS' },
  { name: 'ASSETS_HOST', group: 'Edge', required: true, note: 'Pages origin the Worker proxies' },
  { name: 'HANDOFF', group: 'Edge', required: true, note: 'KV namespace for device handoff' },
  { name: 'NOTIFY_MIN_GAP_HOURS', group: 'Push', required: false, note: 'push frequency cap' },
];

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!isAdmin(request, env)) return unauthorized();
  const items = ENV_ITEMS.map((i) => {
    const v = env[i.name];
    const set = v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '');
    return { ...i, set };
  });
  return json({ items, missingRequired: items.filter((i) => i.required && !i.set).map((i) => i.name), checkedAt: new Date().toISOString() });
};
