/**
 * GET /api/announcements → { announcement: { title, body, link, ts } | null }
 *
 * The latest owner announcement. The Android app checks this on open and
 * resume (its WebView has no Web Push) and shows a local notification once per
 * `ts`. The value is the `announcement` setting, written by the console and
 * by the push sender; a retracted announcement clears the setting.
 */
import type { DbEnv } from '../_lib/db';
import { asObject, clip } from '../_lib/edge';
import { setting } from '../_lib/settings';

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
};

export interface Announcement { title: string; body: string; link: string; ts: number }

/** A valid announcement, or null. Links stay inside the app (a path). */
export function publicAnnouncement(raw: unknown): Announcement | null {
  const a = asObject(raw);
  const title = clip(a?.title, 120);
  const ts = typeof a?.ts === 'number' && Number.isFinite(a.ts) && a.ts > 0 ? Math.floor(a.ts) : null;
  if (!a || !title || !ts) return null;
  const link = clip(a.link, 300);
  return { title, body: clip(a.body, 300) ?? '', link: link && /^\/[^/\\]/.test(link) ? link : '/', ts };
}

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: CORS });

export const onRequestGet = async (ctx?: { env?: DbEnv }): Promise<Response> => {
  const announcement = publicAnnouncement(await setting(ctx?.env ?? {}, 'announcement'));
  return new Response(JSON.stringify({ announcement }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=120', ...CORS },
  });
};
