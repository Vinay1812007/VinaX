/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * SEO catalog walker (4.15.0) — grows the vinax_seo_urls corpus every hour.
 *
 * Each run does a bounded slice of an endless breadth-first walk:
 *   1. Bootstrap (corpus nearly empty): seed artists + songs from live search
 *      across all hub languages.
 *   2. Expand the artist frontier: the 6 least-recently-expanded artists each
 *      contribute one PAGE of their full song list + album list (the big
 *      multiplier — a prolific artist yields thousands of URLs over runs).
 *   3. Expand a few albums: full track lists.
 * Every discovered song also contributes its album + artists, so the frontier
 * grows itself — new artists found today are walked tomorrow.
 *
 * Bounded to stay far below the Workers subrequest cap; all writes are
 * batched. Protected by CRON_SECRET (see .github/workflows/seo-crawl.yml).
 * PUBLIC catalog metadata only — nothing user-related is read or written.
 */
import { sbCount, sbSelect, sbUpdate, type SupabaseEnv } from '../../_lib/supabase';
import { SEO_TYPES, artistRows, dedupeRows, harvest, parseResults, seoRow, songRowsDeep, type SeoRow } from '../../_lib/seo';
import { safeEqual } from '../../_lib/safe-compare';

type Env = SupabaseEnv & { CRON_SECRET?: string };

// Same mirror ladder as _lib/render.ts and the live-search sitemaps.
const BASES = ['https://www.sirimillavinay.online/api/cat', 'https://saavn.sumit.co/api', 'https://nepotuneapi.vercel.app/api'];
const LANGS = ['hindi', 'telugu', 'tamil', 'english', 'punjabi', 'kannada', 'malayalam', 'bengali', 'marathi', 'bhojpuri', 'gujarati', 'urdu'];
const ARTISTS_PER_RUN = 6;
const ALBUMS_PER_RUN = 4;

async function fetchJson(suffix: string): Promise<any> {
  for (const base of BASES) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    try {
      const r = await fetch(`${base}/${suffix}`, { headers: { accept: 'application/json' }, signal: ctrl.signal });
      if (r.ok) {
        const j: any = await r.json().catch(() => null);
        if (j?.data) return j;
      }
    } catch {
      /* dead / slow mirror — try the next */
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

function json(o: unknown, status = 200): Response {
  return new Response(JSON.stringify(o), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

interface FrontierRow {
  key: string;
  entity_id: string;
  expand_page: number;
}

/** Seed the corpus from live search when it's (nearly) empty. */
async function bootstrap(): Promise<SeoRow[]> {
  const rows: SeoRow[] = [];
  const artistTasks = LANGS.map((l) => fetchJson(`search/artists?query=${encodeURIComponent(`top ${l} singers`)}&limit=30`));
  const songTasks = LANGS.map((l) => fetchJson(`search/songs?query=${encodeURIComponent(`top ${l} songs`)}&limit=30`));
  const [artistRes, songRes] = await Promise.all([Promise.allSettled(artistTasks), Promise.allSettled(songTasks)]);
  for (const res of artistRes) {
    if (res.status !== 'fulfilled') continue;
    for (const item of parseResults(res.value)) {
      const a = seoRow('artist', item?.id, item?.name);
      if (a) rows.push(a);
    }
  }
  for (const res of songRes) {
    if (res.status !== 'fulfilled') continue;
    for (const item of parseResults(res.value)) rows.push(...songRowsDeep(item));
  }
  return rows;
}

/** One page of one artist's songs + albums. Returns rows + whether more pages remain. */
async function expandArtist(a: FrontierRow): Promise<{ rows: SeoRow[]; more: boolean }> {
  const page = Math.max(0, Number(a.expand_page) || 0);
  const [songsJ, albumsJ] = await Promise.all([
    fetchJson(`artists/${encodeURIComponent(a.entity_id)}/songs?page=${page}&sortBy=popularity&sortOrder=desc`),
    fetchJson(`artists/${encodeURIComponent(a.entity_id)}/albums?page=${page}&sortBy=popularity&sortOrder=desc`),
  ]);
  const songs = parseResults(songsJ);
  const albums = parseResults(albumsJ);
  const rows: SeoRow[] = [];
  for (const s of songs) rows.push(...songRowsDeep(s));
  for (const al of albums) {
    const row = seoRow('album', al?.id, al?.name, al?.language);
    if (row) rows.push(row);
    rows.push(...artistRows(al?.artists));
  }
  return { rows, more: songs.length > 0 || albums.length > 0 };
}

/** An album's full track list. */
async function expandAlbum(al: FrontierRow): Promise<SeoRow[]> {
  const j = await fetchJson(`albums?id=${encodeURIComponent(al.entity_id)}`);
  const d = j?.data;
  const rows: SeoRow[] = [];
  for (const s of Array.isArray(d?.songs) ? d.songs : []) rows.push(...songRowsDeep(s));
  return rows;
}

interface CronContext {
  request: Request;
  env: Env;
  waitUntil?: (p: Promise<unknown>) => void;
}

export const onRequest = async (context: CronContext): Promise<Response> => {
  const { request, env } = context;
  const key = request.headers.get('x-cron-secret') ?? '';
  if (!env.CRON_SECRET || !safeEqual(key, env.CRON_SECRET)) return json({ error: 'unauthorized' }, 401);

  const artistCount = await sbCount(env, 'vinax_seo_urls', 'type=eq.artist');
  if (artistCount === null) {
    // Table missing or Supabase unconfigured — tell the operator exactly what
    // to do instead of silently no-oping every hour.
    return json({ ok: false, reason: 'seo_table_unavailable', hint: 'run supabase/migrations/2026-08-vinax-seo-urls.sql' }, 200);
  }

  const discovered: SeoRow[] = [];
  let expandedArtists = 0;
  let expandedAlbums = 0;

  if (artistCount < 50) {
    discovered.push(...(await bootstrap()));
  } else {
    // Artist frontier: least-recently-expanded first (never-expanded = first).
    const artists = await sbSelect<FrontierRow>(
      env,
      'vinax_seo_urls',
      `type=eq.artist&select=key,entity_id,expand_page&order=expanded_at.asc.nullsfirst&limit=${ARTISTS_PER_RUN}`,
    );
    const now = new Date().toISOString();
    for (const a of artists) {
      const { rows, more } = await expandArtist(a);
      discovered.push(...rows);
      expandedArtists += 1;
      // Exhausted artists restart at page 0 on their next (distant) turn, so
      // new releases are eventually re-swept.
      await sbUpdate(env, 'vinax_seo_urls', `key=eq.${encodeURIComponent(a.key)}`, {
        expanded_at: now,
        expand_page: more ? (Number(a.expand_page) || 0) + 1 : 0,
      });
    }

    // Album frontier: only albums never expanded (their track lists are static).
    const albums = await sbSelect<FrontierRow>(
      env,
      'vinax_seo_urls',
      `type=eq.album&expanded_at=is.null&select=key,entity_id,expand_page&order=added_at.asc&limit=${ALBUMS_PER_RUN}`,
    );
    for (const al of albums) {
      discovered.push(...(await expandAlbum(al)));
      expandedAlbums += 1;
      await sbUpdate(env, 'vinax_seo_urls', `key=eq.${encodeURIComponent(al.key)}`, { expanded_at: now });
    }
  }

  const batch = dedupeRows(discovered);
  const inserted = await harvest(env, batch);
  // Per-type counts (same filtered pattern the sitemap index uses — the
  // unfiltered total proved unreliable in production, 4.15.x "corpus":null).
  const corpus: Record<string, number> = {};
  for (const [plural, type] of Object.entries(SEO_TYPES)) {
    corpus[plural] = (await sbCount(env, 'vinax_seo_urls', `type=eq.${type}`)) ?? -1;
  }
  return json({
    ok: true,
    mode: artistCount < 50 ? 'bootstrap' : 'expand',
    expanded: { artists: expandedArtists, albums: expandedAlbums },
    seen: batch.length,
    inserted,
    corpus,
  });
};
