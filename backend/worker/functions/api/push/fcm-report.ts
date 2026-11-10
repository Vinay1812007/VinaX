/**
 * POST /api/push/fcm-report { stage, result, appVersion? }
 *   → 200 { ok: true } | 400 bad_request | 503 not_configured
 *
 * 1.12.8 — what the Android app's push registration saw, in its own words:
 * "token ok …abcd", "no token: FIS_AUTH_ERROR", "upload 503 …". Usage
 * reports are consent-gated and need the page, so a phone that never got a
 * token could not tell anyone; this keeps the last 30 reports in KV for the
 * console's Setup Check (/api/admin/fcmcheck → reports). No device id, no
 * account, no token (a prefix at most).
 */
import { jsonResponse } from '../../_lib/edge';
import { methodNotAllowed, rateLimit } from '../../_lib/ratelimit';

interface KV { get(key: string): Promise<string | null>; put(key: string, value: string, o?: { expirationTtl?: number }): Promise<void> }
interface Env { HANDOFF?: KV }

export const REPORTS_KEY = 'fcm-reports';
export const REPORTS_MAX = 30;

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

export interface FcmReport { at: string; stage: string; result: string; app: string | null; ua: string | null }

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: CORS });
export const onRequestGet = async (): Promise<Response> => methodNotAllowed();

export const onRequestPost = async (context: { request: Request; env: Env & Record<string, unknown> }): Promise<Response> => {
  const { request, env } = context;
  const limited = rateLimit(request, 'push-report', { capacity: 6, refillPerMinute: 3 }, env);
  if (limited) return limited;
  if (!env.HANDOFF) return jsonResponse({ error: 'not_configured' }, 503, CORS);
  const body = (await request.json().catch(() => null)) as { stage?: unknown; result?: unknown; appVersion?: unknown } | null;
  const stage = typeof body?.stage === 'string' ? body.stage.trim().slice(0, 24) : '';
  const result = typeof body?.result === 'string' ? body.result.trim().slice(0, 300) : '';
  if (!stage || !result) return jsonResponse({ error: 'bad_request' }, 400, CORS);
  const app = typeof body?.appVersion === 'string' ? body.appVersion.slice(0, 32) : request.headers.get('x-vinax-version')?.slice(0, 32) ?? null;
  const ua = request.headers.get('user-agent')?.replace(/^.*\(([^)]*)\).*$/, '$1').slice(0, 80) ?? null;
  const report: FcmReport = { at: new Date().toISOString(), stage, result, app, ua };
  let list: FcmReport[];
  try { list = JSON.parse((await env.HANDOFF.get(REPORTS_KEY)) ?? '[]') as FcmReport[]; } catch { list = []; }
  list = [report, ...(Array.isArray(list) ? list : [])].slice(0, REPORTS_MAX);
  await env.HANDOFF.put(REPORTS_KEY, JSON.stringify(list), { expirationTtl: 30 * 86_400 });
  return jsonResponse({ ok: true }, 200, CORS);
};
