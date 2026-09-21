/**
 * The owner's review of a match: accept the proposed catalogue song, reject
 * the item, or correct it to another catalogue id. Every decision is appended
 * to the match's `history` (what it was, what it became, who, when, why), so
 * a correction can always be traced and undone by another correction.
 */
import { sbSelectResult, sbUpdate, type SupabaseEnv } from '../supabase';
import { CatalogUnavailable } from './catalog';
import type { CatalogLookup } from './matcher';

export type ReviewDecision = 'accept' | 'reject' | 'correct';

export interface ReviewInput {
  id: number;
  decision: ReviewDecision;
  catalogId?: string | null;
  note?: string | null;
  reviewer?: string | null;
}

interface MatchRecord {
  id: number;
  source: string;
  source_item_id: string;
  catalog_id: string | null;
  catalog_title: string | null;
  mapping_confidence: number;
  method: string;
  status: string;
  history: unknown;
}

export type ReviewResult = { ok: true; status: string; catalogId: string | null } | { ok: false; httpStatus: number; error: string };

const MAX_HISTORY = 50;

export async function applyReview(env: SupabaseEnv, input: ReviewInput, lookup: CatalogLookup, now: Date = new Date()): Promise<ReviewResult> {
  if (!Number.isInteger(input.id) || input.id <= 0) return { ok: false, httpStatus: 400, error: 'bad_id' };
  if (!['accept', 'reject', 'correct'].includes(input.decision)) return { ok: false, httpStatus: 400, error: 'unknown_decision' };
  const read = await sbSelectResult<MatchRecord>(env, 'vinax_trend_matches', `select=id,source,source_item_id,catalog_id,catalog_title,mapping_confidence,method,status,history&id=eq.${input.id}&limit=1`);
  if (!read.ok) return { ok: false, httpStatus: 503, error: `db_${read.error}` };
  const row = read.rows[0];
  if (!row) return { ok: false, httpStatus: 404, error: 'not_found' };

  const reviewer = (input.reviewer ?? '').trim().slice(0, 60) || 'owner';
  const note = (input.note ?? '').trim().slice(0, 300) || null;
  const at = now.toISOString();
  const from = { status: row.status, catalogId: row.catalog_id, confidence: row.mapping_confidence, method: row.method };
  let patch: Record<string, unknown>;

  if (input.decision === 'accept') {
    if (!row.catalog_id) return { ok: false, httpStatus: 400, error: 'nothing_to_accept' };
    patch = { status: 'accepted', mapping_confidence: 1, method: 'admin-accepted' };
  } else if (input.decision === 'reject') {
    patch = { status: 'rejected' };
  } else {
    const id = (input.catalogId ?? '').trim();
    if (!/^[A-Za-z0-9_-]{2,40}$/.test(id)) return { ok: false, httpStatus: 400, error: 'bad_catalog_id' };
    let song;
    try {
      song = await lookup(id);
    } catch (err) {
      return { ok: false, httpStatus: 502, error: err instanceof CatalogUnavailable ? 'catalog_unavailable' : 'catalog_error' };
    }
    if (!song) return { ok: false, httpStatus: 404, error: 'catalog_id_not_found' };
    patch = {
      status: 'corrected',
      catalog_id: song.id,
      catalog_title: song.title,
      catalog_artist: song.primaryArtists.join(', '),
      catalog_language: song.language,
      mapping_confidence: 1,
      method: 'admin-corrected',
    };
  }

  const history = Array.isArray(row.history) ? row.history : [];
  const entry = {
    at,
    by: reviewer,
    action: input.decision,
    from,
    to: { status: patch.status, catalogId: (patch.catalog_id as string | undefined) ?? row.catalog_id, confidence: patch.mapping_confidence ?? row.mapping_confidence, method: patch.method ?? row.method },
    note,
  };
  const ok = await sbUpdate(env, 'vinax_trend_matches', `id=eq.${row.id}`, {
    ...patch,
    reviewed_by: reviewer,
    reviewed_at: at,
    // last_seen_at is NOT touched: a review is not a refresh from the source, so the retention clock keeps running.
    history: [...history, entry].slice(-MAX_HISTORY),
  });
  if (!ok) return { ok: false, httpStatus: 500, error: 'db_write_failed' };
  return { ok: true, status: String(patch.status), catalogId: (patch.catalog_id as string | undefined) ?? row.catalog_id };
}
