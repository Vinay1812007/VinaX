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
  { name: 'ADMIN_OWNER_EMAILS', group: 'Admin', required: false, note: 'Google emails that are always Owners of this console (the first admins)' },
  { name: 'ADMIN_LOGIN_PASSWORD', group: 'Admin', required: false, note: 'owner recovery password for the console (Google sign-in is the normal way in)' },
  { name: 'PAGES_DEPLOY_HOOK', group: 'Admin', required: false, note: 'lets Google Search → Bots publish robots.txt right away (a website rebuild)' },
  { name: 'DEVICE_ID_SECRET', group: 'Data', required: true, note: 'signed device ids for telemetry' },
  { name: 'TELEMETRY_PEPPER', group: 'Data', required: false, note: 'device id hashing (falls back to DEVICE_ID_SECRET)' },
  { name: 'GOOGLE_CLIENT_ID', group: 'Data', required: false, note: 'optional Google sign-in (plain var; sign-in is off without it)' },
  { name: 'AUTH_SECRET', group: 'Data', required: false, note: 'signs sign-in sessions (falls back to DEVICE_ID_SECRET)' },
  { name: 'TURNSTILE_SITE_KEY', group: 'Data', required: false, note: 'Cloudflare Turnstile site key (plain var, public): with TURNSTILE_SECRET_KEY, a security check on every sign-in (app and console)' },
  { name: 'TURNSTILE_SECRET_KEY', group: 'Data', required: false, note: 'Cloudflare Turnstile secret: with TURNSTILE_SITE_KEY, a security check on every sign-in (off until both are set)' },
  { name: 'CATALOG_UPSTREAMS', group: 'Catalogue', required: false, note: 'comma-separated wrapper base URLs the catalogue tries first, in order (the app only ever sees /api/cat)' },
  { name: 'CATALOG_DIRECT_URL', group: 'Catalogue', required: false, note: 'overrides the direct JioSaavn web API the catalogue falls back to' },
  { name: 'SUPABASE_URL', group: 'Database', required: true, note: 'database project URL' },
  { name: 'SUPABASE_SERVICE_ROLE_KEY', group: 'Database', required: true, note: 'database service-role key (server only)' },
  { name: 'CRON_SECRET', group: 'Cron', required: false, note: 'runs a job by hand through POST /api/cron/run; the Cron Trigger needs no secret' },
  { name: 'VAPID_PUBLIC_KEY', group: 'Push', required: false, note: 'web push' },
  { name: 'VAPID_PRIVATE_KEY', group: 'Push', required: false, note: 'web push' },
  { name: 'VAPID_SUBJECT', group: 'Push', required: false, note: 'web push contact' },
  { name: 'FCM_SERVICE_ACCOUNT', group: 'Push', required: false, note: 'Android push (FCM v1)' },
  { name: 'GITHUB_TOKEN', group: 'Releases', required: false, note: 'APK release proxy + Releases & CI panel' },
  { name: 'GITHUB_REPO', group: 'Releases', required: false, note: 'owner/repo for releases' },
  { name: 'ASSETS_HOST', group: 'Edge', required: true, note: 'Pages origin the Worker proxies' },
  { name: 'HANDOFF', group: 'Edge', required: true, note: 'KV namespace for device handoff' },
  { name: 'NOTIFY_MIN_GAP_HOURS', group: 'Push', required: false, note: 'push frequency cap' },
  // VinaX AI (docs/ai.md): any one provider is enough for the chat to work.
  { name: 'GROQ_API_KEY', group: 'VinaX AI', required: false, note: 'Groq chat models (Auto default), dictation (Whisper) and Read aloud (Orpheus)' },
  { name: 'GEMINI_API_KEY', group: 'VinaX AI', required: false, note: 'Gemini chat models (images, long documents), Live voice, and the voice fallbacks' },
  { name: 'OPENROUTER_API_KEY', group: 'VinaX AI', required: false, note: 'OpenRouter free models' },
  { name: 'NVIDIA_API_KEY', group: 'VinaX AI', required: false, note: 'NVIDIA NIM chat models' },
  { name: 'AI', group: 'VinaX AI', required: false, note: 'Workers AI binding ([ai] in wrangler.toml; last in the failover order)' },
  { name: 'SEARCH_API_KEY', group: 'VinaX AI', required: false, note: 'web search API key (when free Google grounding is not used)' },
  { name: 'SEARCH_API_PROVIDER', group: 'VinaX AI', required: false, note: 'plain var: tavily (default) or serper' },
  { name: 'SEARCH_DAILY_LIMIT', group: 'VinaX AI', required: false, note: 'plain var: search API calls per day for everyone (default 100, 0 = off)' },
];

/** What each key is for, in words anyone understands (the console shows these; the technical name is small text). */
export const PLAIN: Record<string, string> = {
  ADMIN_OWNER_EMAILS: 'First owners of this console',
  ADMIN_LOGIN_PASSWORD: 'Owner recovery password',
  PAGES_DEPLOY_HOOK: 'Website rebuild link',
  DEVICE_ID_SECRET: 'Device signing key',
  TELEMETRY_PEPPER: 'Privacy salt for device ids',
  GOOGLE_CLIENT_ID: 'Google sign-in',
  AUTH_SECRET: 'Sign-in session key',
  TURNSTILE_SITE_KEY: 'Sign-in security check (public key)',
  TURNSTILE_SECRET_KEY: 'Sign-in security check (secret)',
  CATALOG_UPSTREAMS: 'Extra music sources',
  CATALOG_DIRECT_URL: 'Backup music source address',
  SUPABASE_URL: 'Database address',
  SUPABASE_SERVICE_ROLE_KEY: 'Database key',
  CRON_SECRET: 'Run-a-job-by-hand key',
  VAPID_PUBLIC_KEY: 'Browser notifications (public part)',
  VAPID_PRIVATE_KEY: 'Browser notifications (private part)',
  VAPID_SUBJECT: 'Browser notifications contact',
  FCM_SERVICE_ACCOUNT: 'Android notifications',
  GITHUB_TOKEN: 'App releases access',
  GITHUB_REPO: 'App releases location',
  ASSETS_HOST: 'Website files location',
  HANDOFF: 'Device hand-off storage',
  NOTIFY_MIN_GAP_HOURS: 'Old notification limit',
  GROQ_API_KEY: 'AI provider: Groq',
  GEMINI_API_KEY: 'AI provider: Google Gemini',
  OPENROUTER_API_KEY: 'AI provider: OpenRouter',
  NVIDIA_API_KEY: 'AI provider: NVIDIA',
  AI: 'AI provider: Cloudflare',
  SEARCH_API_KEY: 'AI web search',
  SEARCH_API_PROVIDER: 'AI web search provider',
  SEARCH_DAILY_LIMIT: 'AI web searches per day',
};

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!(await isAdminAsync(request, env))) return unauthorized();
  const isSet = (name: string): boolean => {
    const v = env[name];
    return v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '');
  };
  const items = ENV_ITEMS.map((i) => ({ ...i, label: PLAIN[i.name] ?? i.name, set: isSet(i.name) }));
  return json({ items, missingRequired: items.filter((i) => i.required && !i.set).map((i) => i.name), checkedAt: new Date().toISOString() });
};
