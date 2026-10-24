/**
 * GET /api/blocklist → { ids: [...], artists: [...], keywords: [...] }
 *
 * Content the owner blocked (`blocked_content`): song ids, artist names and
 * keywords. The app fetches this once at start-up and hides the matches from
 * results and playback. Public, cached a minute; empty without a database.
 */
import { db, dbConfigured, q, type DbEnv } from '../_lib/db';

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

const answer = (body: { ids: string[]; artists: string[]; keywords: string[] }): Response =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60', ...CORS } });

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: CORS });

export const onRequestGet = async (ctx?: { env?: DbEnv }): Promise<Response> => {
  const env = ctx?.env ?? {};
  const empty = { ids: [], artists: [], keywords: [] };
  if (!dbConfigured(env)) return answer(empty);
  const r = await db.select<{ kind: string; value: string }>(env, 'blocked_content', q().select('kind,value').order('id').limit(2000));
  if (!r.ok) return answer(empty);
  const out: { ids: string[]; artists: string[]; keywords: string[] } = { ids: [], artists: [], keywords: [] };
  for (const row of r.rows) {
    const v = String(row.value ?? '').trim();
    if (!v) continue;
    if (row.kind === 'song') out.ids.push(v);
    else if (row.kind === 'artist') out.artists.push(v);
    else if (row.kind === 'keyword') out.keywords.push(v);
  }
  return answer(out);
};
