/**
 * VinaX AI — files on the way into a chat: which are accepted, the limits
 * (the server checks them again), shrinking images on the device, reading a
 * PDF's text, and the upload itself.
 *
 *   images  png, jpg, webp, gif (first frame): at most 5 per message, shrunk
 *           to a long edge of 1568 px and sent as WebP (JPEG where WebP
 *           cannot be made)
 *   PDFs    up to 20 MB and 100 pages; their text is read here for models
 *           that cannot read PDFs
 *   text    text, markdown, csv, json and source code up to 1 MB
 *   20 files per conversation
 */
import { AI_BASE, AiError } from './api';
import { currentAccount } from '@/services/auth/google';

export type FileKind = 'image' | 'pdf' | 'text';

export const MAX_IMAGES_PER_MESSAGE = 5;
export const MAX_FILES_PER_MESSAGE = 10;
export const MAX_FILES_PER_CONVERSATION = 20;
export const MAX_PDF_BYTES = 20 * 1024 * 1024;
export const MAX_PDF_PAGES = 100;
export const MAX_TEXT_BYTES = 1024 * 1024;
export const MAX_IMAGE_SOURCE_BYTES = 40 * 1024 * 1024;
export const IMAGE_EDGE = 1568;

const CODE_EXT = ['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'jsonc', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'log', 'xml', 'html', 'htm', 'css', 'scss', 'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'kts', 'swift', 'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'php', 'sh', 'bash', 'zsh', 'ps1', 'sql', 'r', 'dart', 'lua', 'pl', 'scala', 'vue', 'svelte', 'gradle'];

/** The file picker's accept list. */
export const ACCEPT = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf', '.pdf', ...CODE_EXT.map((e) => `.${e}`)].join(',');

const ext = (name: string): string => (name.includes('.') ? name.split('.').pop()!.toLowerCase() : '');

export function kindOf(file: { name: string; type: string }): FileKind | null {
  const t = file.type.toLowerCase();
  if (['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(t)) return 'image';
  if (t === 'application/pdf' || ext(file.name) === 'pdf') return 'pdf';
  if (t.startsWith('text/') || t === 'application/json' || CODE_EXT.includes(ext(file.name))) return 'text';
  return null;
}

/** Why a file cannot be added (or null when it can). */
export function refuse(file: { name: string; type: string; size: number }, counts: { images: number; files: number; inConversation: number }): string | null {
  const kind = kindOf(file);
  if (!kind) return `${file.name}: this type of file can’t be added. Images, PDFs and text or code files can.`;
  if (counts.files >= MAX_FILES_PER_MESSAGE) return `At most ${MAX_FILES_PER_MESSAGE} files per message.`;
  if (counts.inConversation + counts.files >= MAX_FILES_PER_CONVERSATION) return `A chat can hold ${MAX_FILES_PER_CONVERSATION} files. Start a new chat to add more.`;
  if (kind === 'image' && counts.images >= MAX_IMAGES_PER_MESSAGE) return `At most ${MAX_IMAGES_PER_MESSAGE} images per message.`;
  if (kind === 'image' && file.size > MAX_IMAGE_SOURCE_BYTES) return `${file.name} is too large.`;
  if (kind === 'pdf' && file.size > MAX_PDF_BYTES) return `${file.name} is over 20 MB.`;
  if (kind === 'text' && file.size > MAX_TEXT_BYTES) return `${file.name} is over 1 MB.`;
  return null;
}

/** The size that fits within `edge` on its long side, keeping the shape (never larger). */
export function fitWithin(width: number, height: number, edge = IMAGE_EDGE): { width: number; height: number } {
  const scale = Math.min(1, edge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** An image shrunk to 1568 px on its long edge, as WebP (or JPEG). A GIF gives its first frame. */
export async function shrinkImage(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = fitWithin(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const toBlob = (type: string, q: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, q));
  const webp = await toBlob('image/webp', 0.85);
  if (webp && webp.type === 'image/webp') return webp;
  // No WebP encoder here: JPEG on white (it has no transparency).
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  const jpeg = await toBlob('image/jpeg', 0.85);
  if (!jpeg) throw new Error('could not encode');
  return jpeg;
}

export interface UploadedFile {
  id: string;
  name: string;
  mime: string;
  size: number;
  kind: FileKind;
  pages?: number;
}

const authHeaders = (): Record<string, string> => {
  const a = currentAccount();
  return a ? { authorization: `Bearer ${a.session}` } : {};
};

/** Send a (prepared) file to POST /api/ai/attachments. */
export async function uploadBlob(blob: Blob, name: string, mime: string, conversationId: string | null, signal?: AbortSignal): Promise<UploadedFile> {
  const qs = new URLSearchParams({ name });
  if (conversationId) qs.set('conversationId', conversationId);
  let res: Response;
  try {
    res = await fetch(`${AI_BASE}/attachments?${qs}`, { method: 'POST', headers: { ...authHeaders(), 'content-type': mime }, body: blob, signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new AiError(0, 'network');
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new AiError(res.status, typeof body.error === 'string' ? body.error : `http_${res.status}`);
  return body as unknown as UploadedFile;
}

export async function sendPdfText(id: string, text: string, pages: number): Promise<void> {
  const res = await fetch(`${AI_BASE}/attachments/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { ...authHeaders(), 'content-type': 'application/json' }, body: JSON.stringify({ text, pages }) });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new AiError(res.status, body.error ?? `http_${res.status}`);
  }
}

export async function removeUpload(id: string): Promise<void> {
  await fetch(`${AI_BASE}/attachments/${encodeURIComponent(id)}`, { method: 'DELETE', headers: authHeaders() }).catch(() => undefined);
}

/** A stored file as a local object URL (the page cannot put a session in an <img src>). */
const fileUrls = new Map<string, Promise<string | null>>();
export function fileUrl(id: string): Promise<string | null> {
  let p = fileUrls.get(id);
  if (!p) {
    p = fetch(`${AI_BASE}/attachments/${encodeURIComponent(id)}`, { headers: authHeaders() })
      .then(async (res) => (res.ok ? URL.createObjectURL(await res.blob()) : null))
      .catch(() => null);
    fileUrls.set(id, p);
  }
  return p;
}

/** Words for an upload failure. */
export function uploadError(code: string, name: string): string {
  switch (code) {
    case 'too_large': return `${name} is too large.`;
    case 'unsupported_type': return `${name} isn’t a file VinaX AI can read.`;
    case 'too_many_files': return `A chat can hold ${MAX_FILES_PER_CONVERSATION} files. Start a new chat to add more.`;
    case 'too_many_pages': return `${name} has more than ${MAX_PDF_PAGES} pages.`;
    case 'network': return `${name} couldn’t be sent. Check your connection.`;
    default: return `${name} couldn’t be added. Try again.`;
  }
}
