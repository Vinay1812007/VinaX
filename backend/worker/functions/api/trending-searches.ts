/** Community top searches (7d) — aggregated anonymous query strings only.
 *  Public + edge-cached; powers the chips under the search bar. */
import { dbSelect, dbConfigured, type DbEnv } from '../_lib/db';

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
};

export const onRequestOptions = async (): Promise<Response> =>
  new Response(null, { status: 204, headers: CORS });

export const onRequestGet = async (context: { env: DbEnv }): Promise<Response> => {
  const { env } = context;
  if (!dbConfigured(env)) {
    return new Response(JSON.stringify({ queries: [] }), {
      headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=600', ...CORS },
    });
  }
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const rows = await dbSelect<{ message: string | null }>(
    env,
    'vinax_events',
    `type=eq.search&created_at=gte.${encodeURIComponent(since)}&select=message&order=created_at.desc&limit=2000`,
  ).catch(() => []);
  const counts = new Map<string, number>();
  for (const r of rows) {
    const raw = r.message ?? '';
    const i = raw.indexOf('|');
    if (i < 0) continue;
    if (Number(raw.slice(0, i)) === 0) continue; // zero-result queries stay out
    const q = raw
      .slice(i + 1)
      .trim()
      .slice(0, 40);
    // Short fragments ("ord", "ora") are typing debris, not queries (DQA-11).
    if (q.length < 4) continue;
    // ...and so are dangling single-char tail tokens ("kalalu c").
    const toks = q.split(/\s+/);
    if (toks[toks.length - 1].length === 1) continue;
    // Never surface junk publicly: digit-heavy strings (phone numbers), emails, URLs.
    const digits = (q.match(/\d/g) ?? []).length;
    if (digits > q.length * 0.4) continue;
    if (q.includes('@') || /https?:|www\./i.test(q)) continue;
    counts.set(q, (counts.get(q) ?? 0) + 1);
  }
  const ranked = [...counts.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([q]) => q);
  // Junk fragments ("an", "ord") survive counting when longer queries share
  // their text — drop anything that is a strict prefix of a longer entry.
  const queries = ranked
    .filter((q) => !ranked.some((o) => o !== q && o.length > q.length && o.toLowerCase().startsWith(q.toLowerCase())))
    .slice(0, 8);
  return new Response(JSON.stringify({ queries }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=600', ...CORS },
  });
};
