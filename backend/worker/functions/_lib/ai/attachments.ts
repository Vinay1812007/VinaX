/**
 * VinaX AI — files added to a chat: what is accepted, how big, how a file is
 * recognised from its first bytes, and how a model is sent it.
 *
 *   image  png, jpeg, webp, gif   ≤ 5 MB (the page shrinks images to 1568 px first)
 *   pdf    pdf                    ≤ 20 MB, ≤ 100 pages
 *   text   text, markdown, csv, json and source code   ≤ 1 MB
 *
 * At most 5 images per message, 10 files per message and 20 per
 * conversation. Images go to vision models as image parts (only from the
 * last 3 questions; older ones become "[image: name]"). PDFs go to Gemini
 * as files (the Files API); every other model gets the text the page read
 * out of them. Text files become <document> blocks. A model that cannot see
 * images is told an image was there.
 */
import { db, q, type DbEnv, type Rows } from '../db';
import { storageRemove } from './storage';

export type AttachmentKind = 'image' | 'pdf' | 'text';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_PDF_BYTES = 20 * 1024 * 1024;
export const MAX_TEXT_BYTES = 1024 * 1024;
export const MAX_PDF_PAGES = 100;
export const MAX_IMAGES_PER_MESSAGE = 5;
export const MAX_FILES_PER_MESSAGE = 10;
export const MAX_FILES_PER_CONVERSATION = 20;
/** Text kept from one file (a PDF's extracted text, a text file). */
export const MAX_EXTRACTED_CHARS = 400_000;
/** Images re-sent with the last this-many questions; older ones become a mention. */
export const IMAGE_TURNS = 3;

export const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const TEXT_MIMES = new Set(['text/plain', 'text/markdown', 'text/csv', 'application/json', 'text/x-python', 'text/javascript', 'application/javascript', 'text/typescript', 'text/html', 'text/css', 'text/xml', 'application/xml', 'application/x-yaml', 'text/yaml']);
const CODE_EXT = /\.(txt|md|markdown|csv|tsv|json|jsonc|ya?ml|toml|ini|cfg|conf|log|xml|html?|css|scss|js|jsx|mjs|cjs|ts|tsx|py|rb|go|rs|java|kt|kts|swift|c|h|cc|cpp|hpp|cs|php|sh|bash|zsh|ps1|sql|r|dart|lua|pl|scala|vue|svelte|gradle|dockerfile|env|gitignore)$/i;

export function kindOf(mime: string, name: string): AttachmentKind | null {
  const m = mime.toLowerCase().split(';')[0].trim();
  if (IMAGE_MIMES.has(m)) return 'image';
  if (m === 'application/pdf') return 'pdf';
  if (TEXT_MIMES.has(m) || m.startsWith('text/') || CODE_EXT.test(name)) return 'text';
  return null;
}

export const maxBytes = (kind: AttachmentKind): number => (kind === 'image' ? MAX_IMAGE_BYTES : kind === 'pdf' ? MAX_PDF_BYTES : MAX_TEXT_BYTES);

/** Does the file start the way its type says? Text must not be binary. */
export function sniff(kind: AttachmentKind, mime: string, head: Uint8Array): boolean {
  const at = (i: number, ...bytes: number[]) => bytes.every((b, j) => head[i + j] === b);
  if (kind === 'pdf') return at(0, 0x25, 0x50, 0x44, 0x46, 0x2d); // %PDF-
  if (kind === 'image') {
    const m = mime.toLowerCase();
    if (m === 'image/png') return at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    if (m === 'image/jpeg') return at(0, 0xff, 0xd8, 0xff);
    if (m === 'image/gif') return at(0, 0x47, 0x49, 0x46, 0x38);
    if (m === 'image/webp') return at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50);
    return false;
  }
  // Text: no NUL bytes in the first chunk.
  return !head.subarray(0, 8192).includes(0);
}

/** A file name safe to show and to put in a <document name="…">. */
export function cleanName(raw: unknown): string {
  const n = typeof raw === 'string' ? raw : '';
  const base = n.split(/[\\/]/).pop() ?? '';
  const visible = [...base].filter((ch) => ch.charCodeAt(0) >= 32 && !'"<>`'.includes(ch)).join('');
  const clean = visible.replace(/\s+/g, ' ').trim().slice(0, 120);
  return clean || 'file';
}

export interface AttachmentRow {
  id: string;
  account_id: string;
  conversation_id: string | null;
  name: string;
  mime: string;
  size: number;
  kind: AttachmentKind;
  storage_path: string;
  extracted_text: string | null;
  pages: number | null;
  gemini_uri: string | null;
  gemini_expires_at: string | null;
  created_at: string;
}

export const ATT_COLS = 'id,account_id,conversation_id,name,mime,size,kind,storage_path,extracted_text,pages,gemini_uri,gemini_expires_at,created_at';

/** The account's attachments with these ids (others are silently not there). */
export function loadAttachments(env: DbEnv, accountId: string, ids: string[]): Promise<Rows<AttachmentRow>> {
  if (!ids.length) return Promise.resolve({ ok: true, rows: [] });
  return db.select<AttachmentRow>(env, 'ai_attachments', q().eq('account_id', accountId).in('id', ids).select(ATT_COLS));
}

/** What a message's content keeps about a file, so the page can show it without another query. */
export function attachmentPart(r: AttachmentRow): { type: 'attachment'; id: string; name: string; mime: string; kind: AttachmentKind; size: number; pages?: number } {
  return { type: 'attachment', id: r.id, name: r.name, mime: r.mime, kind: r.kind, size: r.size, ...(r.pages ? { pages: r.pages } : {}) };
}

/** A text file or a PDF's text, as material for the model (never instructions). */
export function documentBlock(name: string, text: string): string {
  const body = text.length > MAX_EXTRACTED_CHARS ? `${text.slice(0, MAX_EXTRACTED_CHARS)}\n[… the rest of this file was left out …]` : text;
  return `<document name="${name.replace(/"/g, "'")}">\n${body.replace(/<\/document>/gi, '</ document>')}\n</document>`;
}

/** Base64 of bytes: the engine's own encoder when it has one (fast), else btoa in chunks. */
export function toBase64(bytes: Uint8Array): string {
  const native = (bytes as Uint8Array & { toBase64?: () => string }).toBase64;
  if (typeof native === 'function') return native.call(bytes);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * Remove every stored file of an account (before the account row goes; the
 * rows then cascade). Best effort: a failure leaves files that nobody can
 * reach, never an account that cannot be deleted.
 */
export async function removeAccountFiles(env: DbEnv, accountId: string): Promise<void> {
  const r = await db.select<{ storage_path: string }>(env, 'ai_attachments', q().eq('account_id', accountId).select('storage_path').limit(5_000));
  if (r.ok && r.rows.length) await storageRemove(env, r.rows.map((x) => x.storage_path));
}
