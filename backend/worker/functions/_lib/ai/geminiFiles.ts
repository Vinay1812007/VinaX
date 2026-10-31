/**
 * VinaX AI — PDFs for Gemini through the Files API, so the Worker streams the
 * bytes from Storage to Google instead of base64-encoding up to 20 MB (which
 * the Worker's CPU budget cannot afford).
 *
 *   1. POST upload/v1beta/files  (X-Goog-Upload-Protocol: resumable, Command: start,
 *      Header-Content-Length / Header-Content-Type, body { file: { display_name } })
 *      → the upload URL in the x-goog-upload-url header
 *   2. POST <upload URL>  (X-Goog-Upload-Offset: 0, Command: upload, finalize) with the bytes
 *      → { file: { uri, expirationTime } }
 *
 * Google keeps a file 48 hours; its uri is saved on the attachment and
 * reused until an hour before it expires.
 */
import { db, q, type DbEnv } from '../db';
import { storageGet } from './storage';
import type { AttachmentRow } from './attachments';

const UPLOAD = 'https://generativelanguage.googleapis.com/upload/v1beta/files';
const KEEP_MS = 47 * 60 * 60_000;
const MARGIN_MS = 60 * 60_000;

export async function ensureGeminiFile(env: DbEnv & { GEMINI_API_KEY?: string }, row: AttachmentRow, now = Date.now()): Promise<string | null> {
  if (row.gemini_uri && row.gemini_expires_at && Date.parse(row.gemini_expires_at) - MARGIN_MS > now) return row.gemini_uri;
  const key = env.GEMINI_API_KEY?.trim();
  if (!key) return null;
  try {
    const start = await fetch(UPLOAD, {
      method: 'POST',
      headers: {
        'x-goog-api-key': key,
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(row.size),
        'X-Goog-Upload-Header-Content-Type': row.mime,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ file: { display_name: row.name.slice(0, 100) } }),
      signal: AbortSignal.timeout(15_000),
    });
    const url = start.headers.get('x-goog-upload-url');
    await start.body?.cancel().catch(() => undefined);
    if (!start.ok || !url) return null;
    const file = await storageGet(env, row.storage_path);
    if (!file?.body) return null;
    const done = await fetch(url, {
      method: 'POST',
      headers: { 'content-length': String(row.size), 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' },
      body: file.body,
      signal: AbortSignal.timeout(60_000),
      duplex: 'half',
    } as RequestInit);
    const j = (await done.json().catch(() => null)) as { file?: { uri?: string; expirationTime?: string } } | null;
    const uri = done.ok ? j?.file?.uri : undefined;
    if (!uri) return null;
    const expires = j?.file?.expirationTime && !Number.isNaN(Date.parse(j.file.expirationTime)) ? j.file.expirationTime : new Date(now + KEEP_MS).toISOString();
    await db.update(env, 'ai_attachments', q().eq('id', row.id), { gemini_uri: uri, gemini_expires_at: expires });
    return uri;
  } catch {
    return null;
  }
}
