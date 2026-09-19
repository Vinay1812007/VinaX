/**
 * v5.13.0 — SEO Corpus: what the sitemap walker has discovered so far.
 * Counts per entity type (the numbers the sitemap index is built from), a
 * language split over the newest sample, the freshest additions, and a live
 * reachability check of the public sitemap index — so "why did Search
 * Console stop growing" is one screen instead of four queries.
 */
import { dbFailure, isAdminAsync, unauthorized, type AdminEnv } from '../../_lib/admin';
import { sbCountResult, sbSelectResult, supabaseConfigured, type SupabaseEnv } from '../../_lib/supabase';
import { SEO_PAGE_SIZE, SEO_TYPES } from '../../_lib/seo';

type Env = AdminEnv & SupabaseEnv;

interface Row { key: string; type: string; name?: string | null; lang?: string | null; added_at?: string | null; }

const json = (o: unknown, status = 200): Response =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!(await isAdminAsync(request, env))) return unauthorized();
  if (!supabaseConfigured(env)) return json({ configured: false });
  const origin = new URL(request.url).origin.replace('admin.', 'www.');

  const [countReads, sampleRead, sitemap] = await Promise.all([
    Promise.all(
      Object.entries(SEO_TYPES).map(async ([plural, type]) => ({ plural, type, read: await sbCountResult(env, 'vinax_seo_urls', `type=eq.${type}`) })),
    ),
    sbSelectResult<Row>(env, 'vinax_seo_urls', 'select=key,type,name,lang,added_at&order=added_at.desc&limit=2000'),
    (async () => {
      const t0 = Date.now();
      try {
        const r = await fetch(`${origin}/sitemap.xml`, { headers: { 'user-agent': 'VinaX-Admin-SEO' } });
        const body = await r.text();
        return { status: r.status, ms: Date.now() - t0, entries: (body.match(/<sitemap>/g) ?? []).length, bytes: body.length };
      } catch (e) {
        return { status: 0, ms: Date.now() - t0, entries: 0, bytes: 0, error: e instanceof Error ? e.message : String(e) };
      }
    })(),
  ]);

  // 7.2.0 — a failed count used to read as 0 URLs in the corpus.
  const counts: Array<{ type: string; plural: string; count: number; pages: number }> = [];
  for (const c of countReads) {
    if (!c.read.ok) return dbFailure(c.read, { sitemap });
    counts.push({ type: c.type, plural: c.plural, count: c.read.value, pages: Math.ceil(c.read.value / SEO_PAGE_SIZE) });
  }
  if (!sampleRead.ok) return dbFailure(sampleRead, { sitemap });
  const sample = sampleRead.rows;
  const langs = new Map<string, number>();
  const byDay = new Map<string, number>();
  for (const r of sample) {
    const l = (r.lang ?? 'unknown').toLowerCase();
    langs.set(l, (langs.get(l) ?? 0) + 1);
    const d = (r.added_at ?? '').slice(0, 10);
    if (d) byDay.set(d, (byDay.get(d) ?? 0) + 1);
  }
  const total = counts.reduce((a, c) => a + c.count, 0);
  return json({
    configured: true,
    total,
    counts,
    languages: [...langs.entries()].map(([lang, n]) => ({ lang, n })).sort((a, b) => b.n - a.n).slice(0, 12),
    addedByDay: [...byDay.entries()].map(([day, n]) => ({ day, n })).sort((a, b) => (a.day < b.day ? -1 : 1)).slice(-14),
    newest: sample.slice(0, 25).map((r) => ({ key: r.key, type: r.type, name: r.name ?? '', lang: r.lang ?? '', added_at: r.added_at ?? '' })),
    sampled: sample.length,
    sitemap,
  });
};
