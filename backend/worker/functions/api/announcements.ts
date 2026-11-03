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

export type AnnouncementShow = 'once' | 'always' | 'daily';
export type AnnouncementPlatform = 'android' | 'web' | 'ios';

/**
 * `ts` changes on every publish (a new announcement shows again). Console rebuild
 * adds the in-app pop-up the console's Home Screen page publishes: `popup`
 * true, a button label, how often it shows, and on which platforms. A value
 * the push sender wrote (no `popup`) stays an Android notification only.
 */
export interface Announcement {
  title: string; body: string; link: string; ts: number;
  popup?: true; button?: string; show?: AnnouncementShow; platforms?: AnnouncementPlatform[];
}

const PLATFORMS: readonly AnnouncementPlatform[] = ['android', 'web', 'ios'];

/** A valid announcement, or null (switched off, outside its dates, malformed). Links stay inside the app (a path). */
export function publicAnnouncement(raw: unknown, now = Date.now()): Announcement | null {
  const a = asObject(raw);
  const title = clip(a?.title, 120);
  const ts = typeof a?.ts === 'number' && Number.isFinite(a.ts) && a.ts > 0 ? Math.floor(a.ts) : null;
  if (!a || !title || !ts || a.enabled === false) return null;
  const start = typeof a.start === 'string' && a.start ? Date.parse(a.start) : NaN;
  const end = typeof a.end === 'string' && a.end ? Date.parse(a.end.length === 10 ? `${a.end}T23:59:59+05:30` : a.end) : NaN;
  if ((!Number.isNaN(start) && now < start) || (!Number.isNaN(end) && now > end)) return null;
  const link = clip(a.link, 300);
  const out: Announcement = { title, body: clip(a.body, 300) ?? '', link: link && /^\/[^/\\]/.test(link) ? link : '/', ts };
  if (a.popup === true) {
    out.popup = true;
    const button = clip(a.button, 30);
    if (button) out.button = button;
    out.show = a.show === 'always' || a.show === 'daily' ? a.show : 'once';
    const pf = Array.isArray(a.platforms) ? PLATFORMS.filter((p) => (a.platforms as unknown[]).includes(p)) : [];
    out.platforms = pf.length ? pf : [...PLATFORMS];
  }
  return out;
}

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: CORS });

export const onRequestGet = async (ctx?: { env?: DbEnv }): Promise<Response> => {
  const announcement = publicAnnouncement(await setting(ctx?.env ?? {}, 'announcement'));
  return new Response(JSON.stringify({ announcement }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=120', ...CORS },
  });
};
