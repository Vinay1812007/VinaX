/**
 * /api/admin/trends — owner-only. Pins: unauthorized requests are refused
 * before any database work; the dashboard reports provider status, freshness,
 * quota, retention, the confidence distribution and the review queue with the
 * source's own evidence; review decisions keep a correction history; imports
 * are validated and all-or-nothing; withdrawals take effect.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeRest, type FakeRest } from '../../_lib/trends/fakeRest.testutil';
import { confidenceBuckets, onRequestGet, onRequestPost } from './trends';

const ENV = { ADMIN_LOGIN_PASSWORD: 'admin-secret', SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'srk' };
let db: FakeRest;
let ip = 0;

/** Catalogue upstream as the self-hosted catalogue handler calls it (song details and search). */
const CATALOG_SONG = { id: 'c7', title: 'Monica (From &quot;Coolie&quot;)', language: 'tamil', year: '2025', more_info: { album: 'Coolie', duration: '240', artistMap: { primary_artists: [{ id: 'a', name: 'Sublahshini' }] } } };

beforeEach(() => {
  db = createFakeRest();
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const hit = db.handle(url, init);
    if (hit) return hit;
    if (url.includes('__call=song.getDetails')) {
      const known = url.includes('pids=c7');
      return Promise.resolve(new Response(JSON.stringify({ songs: known ? [CATALOG_SONG] : [] }), { status: 200 }));
    }
    if (url.includes('__call=search.getResults')) return Promise.resolve(new Response(JSON.stringify({ results: [CATALOG_SONG] }), { status: 200 }));
    return Promise.resolve(new Response('not stubbed', { status: 599 }));
  });
});
afterEach(() => vi.unstubAllGlobals());

function req(method: 'GET' | 'POST', body?: unknown, token: string | null = 'admin-secret'): Request {
  ip += 1;
  const headers: Record<string, string> = { 'content-type': 'application/json', 'cf-connecting-ip': `10.77.${Math.floor(ip / 250)}.${ip % 250}` };
  if (token !== null) headers['x-admin-token'] = token;
  return new Request('https://admin.example.test/api/admin/trends', { method, headers, body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined });
}
const post = async (body: unknown) => {
  const res = await onRequestPost({ request: req('POST', body), env: ENV });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
};

describe('authorisation', () => {
  it('refuses GET and POST without a token or with a wrong one, before touching the database', async () => {
    for (const token of [null, 'wrong']) {
      const g = await onRequestGet({ request: req('GET', undefined, token), env: ENV });
      const p = await onRequestPost({ request: req('POST', { action: 'run' }, token), env: ENV });
      expect(g.status).toBe(401);
      expect(p.status).toBe(401);
      expect(await g.json()).toEqual({ error: 'unauthorized' });
    }
    expect(db.requests).toHaveLength(0);
  });

  it('refuses everyone when the admin secret is not set', async () => {
    const res = await onRequestGet({ request: req('GET'), env: { SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'srk' } });
    expect(res.status).toBe(401);
  });
});

describe('GET dashboard', () => {
  it('reports providers, freshness, quota, retention, confidence and the review queue with evidence', async () => {
    const now = Date.now();
    const iso = (h: number) => new Date(now - h * 3_600_000).toISOString();
    db.insert('vinax_trend_runs', { id: 'r1', source: 'editorial', region: 'IN', trigger: 'cron', started_at: iso(30), finished_at: iso(30), ok: true, status: 'ok', quota_units: 0 });
    db.insert('vinax_trend_runs', { id: 'r2', source: 'editorial', region: 'IN', trigger: 'cron', started_at: iso(1), finished_at: iso(1), ok: false, status: 'error', error: 'db_unavailable: boom', attempts: 3, quota_units: 0 });
    db.insert('vinax_trend_snapshots', { source: 'editorial', region: 'IN', chart: 'editorial', snapshot_key: 'c:1', observed_at: iso(30), fetched_at: iso(30), item_count: 1 });
    db.insert('vinax_trend_observations', { snapshot_id: 1, source: 'youtube', source_item_id: 'AbCdEfGhI01', title: 'Ishq | Singer One', credit: 'Label', url: 'https://www.youtube.com/watch?v=AbCdEfGhI01', source_rank: 4, region: 'IN', observed_at: iso(2) });
    db.insert('vinax_trend_matches', { source: 'youtube', source_item_id: 'AbCdEfGhI01', catalog_id: 'a1', mapping_confidence: 0.92, method: 'title:exact+artist', status: 'review', reason: 'ambiguous', candidates: [{ id: 'a1' }, { id: 'b1' }], last_seen_at: iso(2), history: [] });
    db.insert('vinax_trend_matches', { source: 'youtube', source_item_id: 'x2', catalog_id: 'c2', mapping_confidence: 0.98, method: 'title:exact+artist+film', status: 'matched', last_seen_at: iso(2) });

    const res = await onRequestGet({ request: req('GET'), env: ENV });
    expect(res.status).toBe(200);
    const d = (await res.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(d.providers.map((p: { id: string; status: string }) => [p.id, p.status])).toEqual([
      ['youtube', 'not_configured'],
      ['instagram', 'disabled'],
      ['editorial', 'ok'],
    ]);
    expect(d.providers[1].reason).toMatch(/No verified API/);
    const editorial = d.freshness.find((f: { source: string }) => f.source === 'editorial');
    expect(editorial).toMatchObject({ region: 'IN', stale: true, lastError: { error: 'db_unavailable: boom', attempts: 3 } });
    expect(d.quota.find((q: { source: string }) => q.source === 'youtube')).toMatchObject({ usedToday: 0, dailyBudget: 200 });
    expect(d.retention).toMatchObject({ oldestStoredDays: 1, limitDays: 28 });
    expect(d.matches.byStatus).toEqual({ review: 1, matched: 1 });
    expect(d.reviewQueue).toHaveLength(1);
    expect(d.reviewQueue[0]).toMatchObject({ reason: 'ambiguous', observation: { title: 'Ishq | Singer One', url: 'https://www.youtube.com/watch?v=AbCdEfGhI01', source_rank: 4 } });
  });

  it('names a missing migration instead of showing zeros', async () => {
    db.failing.set('vinax_trend_runs', 404);
    const res = await onRequestGet({ request: req('GET'), env: ENV });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe('db_schema_missing');
  });

  it('buckets confidence at the auto-match threshold', () => {
    expect(confidenceBuckets([{ mapping_confidence: 0.3 }, { mapping_confidence: 0.79 }, { mapping_confidence: 0.8 }, { mapping_confidence: 1 }])).toEqual([
      { range: '0–0.5', count: 1 },
      { range: '0.5–0.8', count: 1 },
      { range: '0.8–0.9', count: 1 },
      { range: '0.9–1', count: 1 },
    ]);
  });
});

describe('POST review', () => {
  beforeEach(() => {
    db.insert('vinax_trend_matches', { source: 'youtube', source_item_id: 'AbCdEfGhI01', catalog_id: 'a1', catalog_title: 'Ishq', mapping_confidence: 0.92, method: 'title:exact+artist', status: 'review', reason: 'ambiguous', history: [{ at: 't0', by: 'matcher', action: 'queued-for-review' }] });
  });

  it('accept makes the proposed song eligible and records who and why', async () => {
    const r = await post({ action: 'review', id: 1, decision: 'accept', note: 'checked the video', reviewer: 'Vinay' });
    expect(r).toMatchObject({ status: 200, json: { ok: true, status: 'accepted', catalogId: 'a1' } });
    const row = db.tables.vinax_trend_matches[0];
    expect(row).toMatchObject({ status: 'accepted', mapping_confidence: 1, method: 'admin-accepted', reviewed_by: 'Vinay' });
    const history = row.history as Array<Record<string, unknown>>;
    expect(history).toHaveLength(2);
    expect(history[1]).toMatchObject({ by: 'Vinay', action: 'accept', from: { status: 'review', catalogId: 'a1', confidence: 0.92 }, to: { status: 'accepted', catalogId: 'a1', confidence: 1 }, note: 'checked the video' });
  });

  it('correct points the item at a verified catalogue song and keeps the previous mapping in history', async () => {
    const r = await post({ action: 'review', id: 1, decision: 'correct', catalogId: 'c7' });
    expect(r).toMatchObject({ status: 200, json: { status: 'corrected', catalogId: 'c7' } });
    const row = db.tables.vinax_trend_matches[0];
    expect(row).toMatchObject({ status: 'corrected', catalog_id: 'c7', catalog_title: 'Monica (From "Coolie")', catalog_artist: 'Sublahshini', catalog_language: 'tamil', method: 'admin-corrected' });
    expect((row.history as Array<{ from: { catalogId: string } }>)[1].from.catalogId).toBe('a1');
  });

  it('refuses a correction to a catalogue id that does not exist', async () => {
    const r = await post({ action: 'review', id: 1, decision: 'correct', catalogId: 'nope42' });
    expect(r).toMatchObject({ status: 404, json: { error: 'catalog_id_not_found' } });
    expect(db.tables.vinax_trend_matches[0].status).toBe('review');
  });

  it('reject keeps the item out for good; unknown ids and decisions are refused', async () => {
    expect((await post({ action: 'review', id: 1, decision: 'reject' })).json).toMatchObject({ status: 'rejected' });
    expect((await post({ action: 'review', id: 99, decision: 'accept' })).status).toBe(404);
    expect((await post({ action: 'review', id: 1, decision: 'maybe' })).status).toBe(400);
  });
});

describe('POST import and withdraw', () => {
  const csv = (rows: string[]) => ['title,artist,evidence_url,starts_at,expires_at', ...rows].join('\n');
  const inAWeek = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);

  it('validate-import reports problems by row and field and writes nothing', async () => {
    const r = await post({ action: 'validate-import', format: 'csv', data: csv([`Monica,Sublahshini,,,${inAWeek}`, `Other,Someone,http://insecure.example/,,${inAWeek}`]) });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: false, rows: 2, valid: 0 });
    expect((r.json.issues as Array<{ row: number; field: string }>).map((i) => [i.row, i.field])).toEqual([
      [1, 'evidence_url'],
      [2, 'evidence_url'],
    ]);
    expect(db.tables.vinax_trend_editorial ?? []).toHaveLength(0);
  });

  it('import refuses the whole file when any row is invalid', async () => {
    const r = await post({ action: 'import', format: 'csv', data: csv([`Monica,Sublahshini,https://example.org/a,,${inAWeek}`, `Bad,Row,,,${inAWeek}`]) });
    expect(r.status).toBe(400);
    expect(db.tables.vinax_trend_editorial ?? []).toHaveLength(0);
  });

  it('import writes valid rows, refreshes editorial at once, and a repeat import adds nothing', async () => {
    const data = csv([`Monica,Sublahshini,https://example.org/a,,${inAWeek}`]);
    const first = await post({ action: 'import', format: 'csv', data });
    expect(first).toMatchObject({ status: 200, json: { ok: true, inserted: 1, alreadyImported: 0 } });
    expect(db.tables.vinax_trend_editorial[0]).toMatchObject({ title: 'Monica', evidence_url: 'https://example.org/a', status: 'active', imported_by: 'owner' });
    // The editorial source ran: one snapshot, one observation, and a confident match through the catalogue search.
    expect(db.tables.vinax_trend_observations).toHaveLength(1);
    expect(db.tables.vinax_trend_matches[0]).toMatchObject({ source: 'editorial', status: 'matched', catalog_id: 'c7' });
    const again = await post({ action: 'import', format: 'csv', data });
    expect(again.json).toMatchObject({ inserted: 0, alreadyImported: 1 });
    expect(db.tables.vinax_trend_editorial).toHaveLength(1);
  });

  it('withdraw stops an entry and refreshes editorial so it disappears', async () => {
    await post({ action: 'import', format: 'json', data: [{ title: 'Monica', artist: 'Sublahshini', evidence_url: 'https://example.org/a', expires_at: inAWeek }] });
    const r = await post({ action: 'withdraw', editorialId: 1 });
    expect(r).toMatchObject({ status: 200, json: { ok: true } });
    expect(db.tables.vinax_trend_editorial[0].status).toBe('withdrawn');
    const snaps = db.tables.vinax_trend_snapshots;
    expect(snaps[snaps.length - 1].item_count).toBe(0);
    expect((await post({ action: 'withdraw', editorialId: 999 })).status).toBe(404);
  });

  it('refuses unknown actions', async () => {
    expect((await post({ action: 'nuke' })).status).toBe(400);
  });
});
