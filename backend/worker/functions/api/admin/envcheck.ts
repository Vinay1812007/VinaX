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
  // The owner's 18 AI secrets (2026-09-09 rotation) — one row each, so a key
  // that was never pasted into Cloudflare shows up here instead of silently
  // degrading its lane through the failover ladder.
  { name: 'VINAX_NVD_NEMOTRON_3_5_LIGHTNING_30B_A3B', group: 'AI', required: false, note: 'dj + chat lane key' },
  { name: 'VINAX_OAI_GPT_OSS_20B', group: 'AI', required: false, note: 'fast lane key' },
  { name: 'VINAX_NVD_NEMOTRON_3_SUPER_120B_A12B', group: 'AI', required: false, note: 'deep lane key' },
  { name: 'VINAX_NVD_NEMOTRON_3_ULTRA_550B_A55B', group: 'AI', required: false, note: 'home lane key' },
  { name: 'VINAX_NVD_NEMOTRON_3_NANO_OMNI_30B_A3B_REASONING', group: 'AI', required: false, note: 'search lane key' },
  { name: 'VINAX_DEEPSEEK_V4_PRO_0813', group: 'AI', required: false, note: 'pro reserve lane key' },
  { name: 'VINAX_MISTRAL_NEMOTRON', group: 'AI', required: false, note: 'general reserve lane key' },
  { name: 'VINAX_KIMI_K3', group: 'AI', required: false, note: 'agent reserve lane key' },
  { name: 'VINAX_GROQ_API_KEY', group: 'AI', required: false, note: 'scholar lane + TTS + free catalog' },
  { name: 'VINAX_OPENROUTER_API_KEY', group: 'AI', required: false, note: 'free-model marketplace lane' },
  { name: 'VINAX_MTA_LMA_3_2_11B_VSN_INT', group: 'AI', required: false, note: 'vision lane key' },
  { name: 'VINAX_MTA_LMA_3_2_90B_VSN_INT', group: 'AI', required: false, note: 'deep vision lane key' },
  { name: 'VINAX_DEEPSEEK_V4_FLASH_0731', group: 'AI', required: false, note: 'bench lane key' },
  { name: 'VINAX_MTA_MUSE_GLIMMER_30B', group: 'AI', required: false, note: 'bench lane key' },
  { name: 'VINAX_NVD_ISING_CALIBRATION_1_5_31B', group: 'AI', required: false, note: 'bench lane key' },
  { name: 'VINAX_POOLSIDE_LAGUNA_XS_2_1', group: 'AI', required: false, note: 'bench lane key' },
  { name: 'VINAX_GGL_DIFFUSIONGEMMA_26B_A4B_IT', group: 'AI', required: false, note: 'bench lane key' },
  { name: 'VINAX_GGL_GEMMA_4_31B_IT', group: 'AI', required: false, note: 'bench lane key' },
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
