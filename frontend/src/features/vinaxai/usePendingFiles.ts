/**
 * VinaX AI — the files waiting in the composer: each is checked, prepared
 * (an image shrunk, a PDF read) and uploaded as soon as it is added, so
 * Send only has to name them. Removing one deletes its upload.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AiError } from './api';
import { kindOf, MAX_PDF_PAGES, refuse, removeUpload, sendPdfText, shrinkImage, uploadBlob, uploadError, type FileKind } from './files';
import type { FileRef } from './types';

export interface PendingFile {
  key: string;
  name: string;
  kind: FileKind;
  status: 'preparing' | 'ready' | 'error';
  error?: string;
  preview?: string;
  ref?: FileRef;
}

let seq = 0;

export function usePendingFiles(conversationId: string | null, inConversation: number) {
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const live = useRef(files);
  live.current = files;
  const patch = (key: string, p: Partial<PendingFile>) => setFiles((fs) => fs.map((f) => (f.key === key ? { ...f, ...p } : f)));

  const prepare = useCallback(async (file: File, key: string, kind: FileKind) => {
    try {
      let ref: FileRef;
      if (kind === 'image') {
        const small = await shrinkImage(file);
        const preview = URL.createObjectURL(small);
        patch(key, { preview });
        const up = await uploadBlob(small, file.name.replace(/\.[^.]+$/, '') + (small.type === 'image/webp' ? '.webp' : '.jpg'), small.type, conversationId);
        ref = { ...up, preview };
      } else if (kind === 'pdf') {
        const { readPdf } = await import('./pdf');
        const read = await readPdf(file).catch(() => null);
        if (read && read.pages > MAX_PDF_PAGES) throw new AiError(413, 'too_many_pages');
        const up = await uploadBlob(file, file.name, 'application/pdf', conversationId);
        if (read) await sendPdfText(up.id, read.text, read.pages).catch(() => undefined);
        ref = { ...up, ...(read ? { pages: read.pages } : {}) };
      } else {
        const up = await uploadBlob(file, file.name, file.type || 'text/plain', conversationId);
        ref = up;
      }
      if (!live.current.some((f) => f.key === key)) {
        // Removed while it was uploading.
        void removeUpload(ref.id);
        return;
      }
      patch(key, { status: 'ready', ref });
    } catch (e) {
      patch(key, { status: 'error', error: uploadError(e instanceof AiError ? e.code : 'failed', file.name) });
    }
  }, [conversationId]);

  const add = useCallback((list: FileList | File[]) => {
    const incoming = [...list];
    let images = live.current.filter((f) => f.kind === 'image').length;
    let count = live.current.length;
    const added: PendingFile[] = [];
    for (const file of incoming) {
      const why = refuse(file, { images, files: count, inConversation });
      if (why) { setNotice(why); continue; }
      const kind = kindOf(file)!;
      const key = `f${++seq}`;
      added.push({ key, name: file.name, kind, status: 'preparing' });
      count += 1;
      if (kind === 'image') images += 1;
      void prepare(file, key, kind).catch(() => undefined);
    }
    if (added.length) setFiles((fs) => [...fs, ...added]);
  }, [inConversation, prepare]);

  const remove = useCallback((key: string) => {
    const f = live.current.find((x) => x.key === key);
    if (f?.ref) void removeUpload(f.ref.id);
    if (f?.preview) URL.revokeObjectURL(f.preview);
    setFiles((fs) => fs.filter((x) => x.key !== key));
  }, []);

  /** Hand the ready files to a message (their previews now belong to it). */
  const take = useCallback((): FileRef[] => {
    const ready = live.current.filter((f) => f.status === 'ready' && f.ref).map((f) => f.ref!);
    setFiles([]);
    return ready;
  }, []);

  /** Put files back after a send that was refused. */
  const restore = useCallback((refs: FileRef[]) => {
    setFiles((fs) => [...refs.map((ref) => ({ key: `f${++seq}`, name: ref.name, kind: ref.kind, status: 'ready' as const, preview: ref.preview, ref })), ...fs]);
  }, []);

  const clear = useCallback(() => {
    for (const f of live.current) {
      if (f.ref) void removeUpload(f.ref.id);
      if (f.preview) URL.revokeObjectURL(f.preview);
    }
    setFiles([]);
  }, []);

  // A new chat (or another one) starts with an empty tray.
  useEffect(() => () => setNotice(null), [conversationId]);

  return {
    files, add, remove, take, restore, clear,
    busy: files.some((f) => f.status === 'preparing'),
    hasImages: files.some((f) => f.kind === 'image' && f.status !== 'error'),
    notice, dismissNotice: () => setNotice(null),
  };
}
