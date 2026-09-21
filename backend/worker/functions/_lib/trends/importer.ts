/**
 * Editorial imports: the owner's hand-curated trend entries, as CSV or JSON.
 *
 * Every row must carry an evidence link a person can open (https only), a
 * start and an expiry no more than MAX_WINDOW_DAYS apart, and either an
 * artist or a catalogue id. An import is all-or-nothing: one invalid row and
 * nothing is written, and the owner gets every problem at once, by row and
 * field. Validation writes nothing; the admin route commits valid rows.
 *
 * CSV header (order free, names exact):
 *   title,artist,catalog_id,region,language,position,evidence_url,starts_at,expires_at,note
 */
import { canonicalKey } from '../identityCore';
import { REGION_RE } from './types';

export const MAX_IMPORT_ROWS = 200;
export const MAX_WINDOW_DAYS = 90;
export const IMPORT_FIELDS = ['title', 'artist', 'catalog_id', 'region', 'language', 'position', 'evidence_url', 'starts_at', 'expires_at', 'note'] as const;
export const IMPORT_LANGUAGES = ['hindi', 'punjabi', 'tamil', 'telugu', 'malayalam', 'kannada', 'marathi', 'bengali', 'gujarati', 'english', 'bhojpuri', 'haryanvi', 'urdu', 'odia', 'assamese', 'rajasthani'];

export interface ImportIssue {
  /** 1-based data row (the CSV header is row 0). 0 = the file as a whole. */
  row: number;
  field: string;
  message: string;
}

export interface EditorialInsert {
  dedupe_key: string;
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
  status: 'active';
}

/** RFC 4180-style CSV: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = String(text ?? '').replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
      continue;
    }
    if (c === '"' && field === '') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

/** CSV text → records keyed by the header, with header problems reported. */
export function csvRecords(text: string): { records: Array<Record<string, string>>; issues: ImportIssue[] } {
  const rows = parseCsv(text);
  if (!rows.length) return { records: [], issues: [{ row: 0, field: 'file', message: 'The file is empty.' }] };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const issues: ImportIssue[] = [];
  const unknown = header.filter((h) => !(IMPORT_FIELDS as readonly string[]).includes(h));
  if (unknown.length) issues.push({ row: 0, field: 'header', message: `Unknown column(s): ${unknown.join(', ')}. Allowed: ${IMPORT_FIELDS.join(', ')}.` });
  for (const need of ['title', 'evidence_url', 'expires_at']) if (!header.includes(need)) issues.push({ row: 0, field: 'header', message: `Missing required column "${need}".` });
  const records = rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
  return { records, issues };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/** A date-only value means 00:00 UTC that day. Returns ISO or null. */
export function parseDate(v: string): string | null {
  const s = v.trim();
  if (!DATE_RE.test(s)) return null;
  const iso = s.length === 10 ? `${s}T00:00:00Z` : /[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s.replace(' ', 'T') : `${s.replace(' ', 'T')}Z`;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** https only, a real host, no embedded credentials. */
export function validEvidenceUrl(v: string): string | null {
  if (!v || v.length > 500) return null;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || !u.hostname.includes('.') || u.username || u.password) return null;
  return u.toString();
}

const cell = (v: unknown): string => (v === null || v === undefined ? '' : String(v)).trim();

export function validateEditorialRows(input: unknown[], now: Date): { valid: EditorialInsert[]; issues: ImportIssue[] } {
  const issues: ImportIssue[] = [];
  if (!Array.isArray(input) || input.length === 0) return { valid: [], issues: [{ row: 0, field: 'file', message: 'No rows to import.' }] };
  if (input.length > MAX_IMPORT_ROWS) return { valid: [], issues: [{ row: 0, field: 'file', message: `At most ${MAX_IMPORT_ROWS} rows per import (got ${input.length}).` }] };
  const valid: EditorialInsert[] = [];
  const keys = new Set<string>();
  input.forEach((raw, idx) => {
    const row = idx + 1;
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const bad = (field: string, message: string): void => {
      issues.push({ row, field, message });
    };
    const title = cell(r.title);
    const artist = cell(r.artist);
    const catalogId = cell(r.catalog_id);
    const region = (cell(r.region) || 'IN').toUpperCase();
    const language = cell(r.language).toLowerCase();
    const positionRaw = cell(r.position);
    const evidence = validEvidenceUrl(cell(r.evidence_url));
    const startsAt = cell(r.starts_at) ? parseDate(cell(r.starts_at)) : now.toISOString();
    const expiresAt = cell(r.expires_at) ? parseDate(cell(r.expires_at)) : null;
    const note = cell(r.note);
    const before = issues.length;

    if (!title) bad('title', 'A title is required.');
    else if (title.length > 200) bad('title', 'Titles are at most 200 characters.');
    if (artist.length > 200) bad('artist', 'Artist names are at most 200 characters.');
    if (!artist && !catalogId) bad('artist', 'Give an artist or a catalog_id, so the entry can be matched to one song.');
    if (catalogId && !/^[A-Za-z0-9_-]{2,40}$/.test(catalogId)) bad('catalog_id', 'A catalogue id is 2–40 letters, digits, "-" or "_".');
    if (!REGION_RE.test(region)) bad('region', 'Region is a two-letter country code such as IN.');
    if (language && !IMPORT_LANGUAGES.includes(language)) bad('language', `Unknown language "${language}".`);
    let position = Math.min(row, 100);
    if (positionRaw) {
      position = Number(positionRaw);
      if (!Number.isInteger(position) || position < 1 || position > 100) bad('position', 'Position is a whole number from 1 to 100.');
    }
    if (!cell(r.evidence_url)) bad('evidence_url', 'An evidence link is required: a public page a person can open to check the claim.');
    else if (!evidence) bad('evidence_url', 'The evidence link must be a full https:// address without a user name or password.');
    if (!startsAt) bad('starts_at', 'starts_at must be a date (YYYY-MM-DD) or an ISO date-time.');
    if (!cell(r.expires_at)) bad('expires_at', 'An expiry is required; editorial entries never run forever.');
    else if (!expiresAt) bad('expires_at', 'expires_at must be a date (YYYY-MM-DD) or an ISO date-time.');
    if (startsAt && expiresAt) {
      const span = Date.parse(expiresAt) - Date.parse(startsAt);
      if (span <= 0) bad('expires_at', 'The expiry must be after the start.');
      else if (span > MAX_WINDOW_DAYS * 86_400_000) bad('expires_at', `An entry may run for at most ${MAX_WINDOW_DAYS} days.`);
      if (Date.parse(expiresAt) <= now.getTime()) bad('expires_at', 'This entry has already expired.');
    }
    if (note.length > 300) bad('note', 'Notes are at most 300 characters.');
    if (issues.length > before || !startsAt || !expiresAt || !evidence) return;

    const dedupe = `${region}|${canonicalKey(title, artist)}|${catalogId}|${startsAt.slice(0, 10)}`.slice(0, 300);
    if (keys.has(dedupe)) {
      bad('title', 'This row repeats an earlier row (same song, region and start date).');
      return;
    }
    keys.add(dedupe);
    valid.push({
      dedupe_key: dedupe,
      title,
      artist: artist || null,
      catalog_id: catalogId || null,
      region,
      language: language || null,
      position,
      evidence_url: evidence,
      note: note || null,
      starts_at: startsAt,
      expires_at: expiresAt,
      status: 'active',
    });
  });
  return { valid: issues.length ? [] : valid, issues };
}

/** Accept `{ format: 'csv', data: string }` or `{ format: 'json', data: [...] | string }`. */
export function readImport(format: unknown, data: unknown, now: Date): { valid: EditorialInsert[]; issues: ImportIssue[]; rows: number } {
  if (format === 'csv') {
    if (typeof data !== 'string') return { valid: [], issues: [{ row: 0, field: 'file', message: 'CSV data must be text.' }], rows: 0 };
    const { records, issues } = csvRecords(data);
    if (issues.length) return { valid: [], issues, rows: records.length };
    const out = validateEditorialRows(records, now);
    return { ...out, rows: records.length };
  }
  if (format === 'json') {
    let list: unknown = data;
    if (typeof data === 'string') {
      try {
        list = JSON.parse(data);
      } catch {
        return { valid: [], issues: [{ row: 0, field: 'file', message: 'The JSON could not be parsed.' }], rows: 0 };
      }
    }
    if (!Array.isArray(list)) return { valid: [], issues: [{ row: 0, field: 'file', message: 'JSON imports are an array of entries.' }], rows: 0 };
    const out = validateEditorialRows(list, now);
    return { ...out, rows: list.length };
  }
  return { valid: [], issues: [{ row: 0, field: 'format', message: 'format must be "csv" or "json".' }], rows: 0 };
}
