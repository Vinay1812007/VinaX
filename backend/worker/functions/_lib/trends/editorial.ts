/**
 * Editorial pins: songs the owner features by hand, each with an evidence
 * link, a start and an expiry (imported through /api/admin/trends; the rules
 * are in importer.ts). They are labelled editorial everywhere they appear,
 * never as a public chart, and carry no momentum — an editor's ordering is
 * not an observation of popularity.
 */
import { sbSelectResult, supabaseConfigured } from '../supabase';
import { envList, TrendFetchError, type FetchOptions, type RawTrendItem, type TrendProvider, type TrendsEnv } from './types';

export const EDITORIAL_DEFAULT_LABEL = 'Editor’s picks';

export interface EditorialRow {
  id: number;
  title: string;
  artist: string | null;
  catalog_id: string | null;
  region: string;
  language: string | null;
  position: number;
  evidence_url: string;
  note: string | null;
  starts_at: string;
  expires_at: string;
  status: string;
  imported_by: string | null;
  imported_at: string;
}

export const EDITORIAL_COLUMNS = 'id,title,artist,catalog_id,region,language,position,evidence_url,note,starts_at,expires_at,status,imported_by,imported_at';

export function editorialItem(row: EditorialRow, rank: number, observedAt: string): RawTrendItem {
  return {
    source: 'editorial',
    sourceItemId: `ed-${row.id}`,
    sourceUrl: row.evidence_url,
    title: row.title,
    credit: row.artist,
    region: row.region,
    sourceRank: rank,
    observedAt,
    languageEvidence: row.language ? { editorLanguage: row.language } : {},
    statistics: null,
    provenance: { kind: 'editorial', editorialId: row.id, importedBy: row.imported_by, importedAt: row.imported_at, startsAt: row.starts_at, note: row.note },
    catalogIdHint: row.catalog_id,
    artistHint: row.artist,
    expiresAt: row.expires_at,
  };
}

export const editorialProvider: TrendProvider = {
  id: 'editorial',
  kind: 'editorial',
  chart: 'editorial',
  snapshotPolicy: 'content',
  displayHours: null,
  label(env) {
    return (env.TRENDS_EDITORIAL_LABEL ?? '').trim().slice(0, 40) || EDITORIAL_DEFAULT_LABEL;
  },
  status(env) {
    if (envList(env.TRENDS_DISABLED_SOURCES).includes('editorial')) return 'disabled';
    return supabaseConfigured(env) ? 'ok' : 'not_configured';
  },
  statusReason(env) {
    if (envList(env.TRENDS_DISABLED_SOURCES).includes('editorial')) return 'Switched off by the owner (TRENDS_DISABLED_SOURCES).';
    return supabaseConfigured(env) ? null : 'The database is not configured, so there is nowhere to keep editorial imports.';
  },
  maxUnitsPerRun() {
    return 0;
  },
  dailyUnitBudget() {
    return null;
  },
  derivedMetricsAllowed() {
    return false;
  },
  async fetch(env: TrendsEnv, opts: FetchOptions): Promise<RawTrendItem[]> {
    const now = (opts.now ?? new Date()).toISOString();
    const res = await sbSelectResult<EditorialRow>(
      env,
      'vinax_trend_editorial',
      `select=${EDITORIAL_COLUMNS}&status=eq.active&region=eq.${encodeURIComponent(opts.region)}&starts_at=lte.${encodeURIComponent(now)}&expires_at=gt.${encodeURIComponent(now)}&order=position.asc,id.asc&limit=100`,
    );
    if (!res.ok) throw new TrendFetchError(`db_${res.error}`, `Editorial imports could not be read (${res.error})`, { retryable: res.error === 'unavailable', httpStatus: res.httpStatus });
    return res.rows.map((row, i) => editorialItem(row, i + 1, now));
  },
};
