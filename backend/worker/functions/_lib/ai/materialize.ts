/**
 * VinaX AI — the thread as one particular model is sent it, files included.
 *
 *   image  a vision model gets it as an image part, from the last 3 questions
 *          only; older images, and every image for a model that cannot see,
 *          become a mention: "[image: name]"
 *   pdf    Gemini reads the file itself (Files API); any other model gets the
 *          text the page read out of it, as a <document> block
 *   text   a <document> block
 *
 * Images and Gemini files are fetched once per reply and shared by every
 * model the reply tries (memo).
 */
import { documentBlock, IMAGE_TURNS, toBase64, type AttachmentRow } from './attachments';
import { ensureGeminiFile } from './geminiFiles';
import { storageGet } from './storage';
import { typedText, type TreeMessage } from './history';
import type { AiEnv, MessagePart, ModelSpec, NormalizedMessage } from './types';

export interface Turn {
  role: 'user' | 'assistant';
  text: string;
  /** Attachment ids, in the order they were added. */
  files: string[];
}

/** The path as turns; turns in a row from the same side are joined (as toNormalized does). */
export function toTurns(path: readonly TreeMessage[]): Turn[] {
  const out: Turn[] = [];
  for (const r of path) {
    const parts = (Array.isArray(r.content) ? r.content : []) as MessagePart[];
    const text = typedText(parts);
    const files = parts.filter((p) => p?.type === 'attachment' && typeof p.id === 'string').map((p) => p.id as string);
    if (!text.trim() && !files.length) continue;
    const prev = out[out.length - 1];
    if (prev && prev.role === r.role) {
      prev.text = [prev.text, text].filter(Boolean).join('\n\n');
      prev.files.push(...files);
    } else out.push({ role: r.role, text, files });
  }
  return out;
}

/** What Auto's ladder needs to know: images in the recent questions, a PDF anywhere. */
export function fileSignals(turns: readonly Turn[], rows: ReadonlyMap<string, AttachmentRow>): { hasImages: boolean; hasPdf: boolean } {
  const recent = recentUserTurns(turns);
  let hasImages = false;
  let hasPdf = false;
  turns.forEach((t, i) => {
    for (const id of t.files) {
      const kind = rows.get(id)?.kind;
      if (kind === 'pdf') hasPdf = true;
      if (kind === 'image' && recent.has(i)) hasImages = true;
    }
  });
  return { hasImages, hasPdf };
}

function recentUserTurns(turns: readonly Turn[]): Set<number> {
  const out = new Set<number>();
  for (let i = turns.length - 1; i >= 0 && out.size < IMAGE_TURNS; i--) if (turns[i].role === 'user') out.add(i);
  return out;
}

export interface Memo {
  images: Map<string, Promise<{ mime: string; data: string } | null>>;
  gemini: Map<string, Promise<string | null>>;
}
export const newMemo = (): Memo => ({ images: new Map(), gemini: new Map() });

function imageData(env: AiEnv, row: AttachmentRow, memo: Memo) {
  let p = memo.images.get(row.id);
  if (!p) {
    p = (async () => {
      const res = await storageGet(env, row.storage_path);
      if (!res) return null;
      const bytes = new Uint8Array(await res.arrayBuffer());
      return { mime: row.mime, data: toBase64(bytes) };
    })().catch(() => null);
    memo.images.set(row.id, p);
  }
  return p;
}

function geminiUri(env: AiEnv, row: AttachmentRow, memo: Memo) {
  let p = memo.gemini.get(row.id);
  if (!p) {
    p = ensureGeminiFile(env, row).catch(() => null);
    memo.gemini.set(row.id, p);
  }
  return p;
}

export async function materialize(env: AiEnv, turns: readonly Turn[], spec: ModelSpec, rows: ReadonlyMap<string, AttachmentRow>, memo: Memo): Promise<NormalizedMessage[]> {
  const recent = recentUserTurns(turns);
  const out: NormalizedMessage[] = [];
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    const docs: string[] = [];
    const notes: string[] = [];
    const images: NonNullable<NormalizedMessage['images']> = [];
    const files: NonNullable<NormalizedMessage['files']> = [];
    for (const id of t.files) {
      const row = rows.get(id);
      if (!row) { notes.push('[a file that is no longer available]'); continue; }
      if (row.kind === 'image') {
        if (spec.flags.vision && recent.has(i)) {
          const img = await imageData(env, row, memo);
          if (img) images.push(img);
          else notes.push(`[image: ${row.name} (it could not be loaded)]`);
        } else notes.push(spec.flags.vision ? `[image: ${row.name}]` : `[image: ${row.name} (this model cannot see images)]`);
      } else if (row.kind === 'pdf') {
        const uri = spec.provider === 'gemini' && spec.flags.pdf ? await geminiUri(env, row, memo) : null;
        if (uri) files.push({ mime: row.mime, uri });
        else if (row.extracted_text?.trim()) docs.push(documentBlock(row.name, row.extracted_text));
        else notes.push(`[document: ${row.name} (its text could not be read)]`);
      } else docs.push(documentBlock(row.name, row.extracted_text ?? ''));
    }
    const text = [...docs, ...notes, t.text].filter(Boolean).join('\n\n');
    out.push({ role: t.role, text: text || (images.length || files.length ? '(see the attached files)' : ''), ...(images.length ? { images } : {}), ...(files.length ? { files } : {}) });
  }
  return out.filter((m) => m.text.trim() || m.images?.length || m.files?.length);
}
