/** Browser-only attachment preparation. Files stay local until the message is sent. */
export const MAX_ATTACHMENTS = 24;
export const MAX_IMAGES = 6;
export const MAX_TEXT_BYTES = 2_000_000;
export const MAX_IMAGE_BYTES = 4_000_000;
const MAX_IMAGE_DATA = 5_500_000; // below the existing Worker 6MB image-body limit
const TEXT_BUDGET = 18_000; // leaves room within the Worker's 24k message cap
const SCAN_LIMIT = 1000;
const TEXT_EXTENSIONS =
  'txt md markdown csv tsv json jsonl log xml yml yaml toml ini html htm css scss less js mjs cjs jsx ts tsx py java kt c h cpp hpp cs go rs rb php sh bash sql r swift dart vue svelte svg'.split(
    ' ',
  );
export const ATTACHMENT_ACCEPT = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  // 9.1.0 — PDFs are read for their text layer (./pdfText.ts).
  'application/pdf',
  ...TEXT_EXTENSIONS.map((ext) => `.${ext}`),
].join(',');
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', 'build', 'coverage', '__pycache__']);

export interface Attachment {
  /** 9.1.0 — `pdf` is a document whose TEXT was extracted; it travels as text. */
  kind: 'image' | 'text' | 'pdf';
  name: string;
  path: string;
  key: string;
  size: number;
  dataUrl?: string;
  text?: string;
  shortened?: boolean;
}
export interface SelectedFile {
  file: File;
  path: string;
}
export interface FileSelection {
  files: SelectedFile[];
  notices: string[];
}

export function pickerFiles(files: FileList | File[]): FileSelection {
  return {
    files: Array.from(files).map((file) => ({ file, path: file.webkitRelativePath || file.name })),
    notices: [],
  };
}
function ignored(path: string): boolean {
  return path.split('/').some((part) => part.startsWith('.') || SKIP_DIRECTORIES.has(part));
}
function fileKind(file: File): Attachment['kind'] | null {
  if (IMAGE_TYPES.has(file.type) || /\.(png|jpe?g|webp|gif)$/i.test(file.name)) return 'image';
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return 'pdf';
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  return TEXT_EXTENSIONS.includes(extension) ||
    /^(readme|license|dockerfile|makefile)$/i.test(file.name)
    ? 'text'
    : null;
}
function readFile(file: File, image: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.onabort = () => reject(new Error('Reading cancelled'));
    if (image) reader.readAsDataURL(file);
    else reader.readAsText(file);
  });
}
export function attachmentText(attachment: Attachment): string {
  return `\n\n--- File: ${attachment.path}${attachment.shortened ? ' (excerpt)' : ''} ---\n${attachment.text ?? ''}`;
}

/**
 * 9.1.0 — progress and cancellation for a batch. `prepareAttachments` reads files
 * one at a time (they can be large, and a folder can hold hundreds), so a caller
 * that passes these can show which file is being read and stop part-way. What has
 * already been read is kept — cancelling is not losing.
 */
export interface PrepareOptions {
  /** Called before each file is read: 1-based position, the total, and its path. */
  onProgress?: (done: number, total: number, path: string) => void;
  /** Checked between files; true stops the batch and keeps what is done. */
  signal?: AbortSignal;
}

export async function prepareAttachments(
  selection: FileSelection,
  existing: Attachment[],
  options: PrepareOptions = {},
): Promise<{ attachments: Attachment[]; notices: string[]; cancelled?: boolean }> {
  const attachments = [...existing];
  const notices = [...selection.notices];
  const seen = new Set(existing.map((file) => file.key));
  let imageData = existing.reduce((sum, file) => sum + (file.dataUrl?.length ?? 0), 0);
  let textUsed = existing
    .filter((file) => file.kind === 'text')
    .reduce((sum, file) => sum + attachmentText(file).length, 0);
  let hidden = 0;
  const queue = selection.files.slice(0, SCAN_LIMIT);
  let cancelled = false;
  let done = 0;
  for (const { file, path: rawPath } of queue) {
    // 9.1.0 — checked between files, so a half-read batch keeps what it got.
    if (options.signal?.aborted) {
      cancelled = true;
      break;
    }
    done += 1;
    options.onProgress?.(done, queue.length, rawPath);
    if (ignored(rawPath)) {
      hidden++;
      continue;
    }
    const path = [...rawPath]
      .filter((char) => {
        const code = char.charCodeAt(0);
        return code !== 0 && code > 31 && code !== 127;
      })
      .join('')
      .slice(0, 200);
    const key = `${rawPath}:${file.size}:${file.lastModified}`;
    if (seen.has(key)) {
      notices.push(`${path}: already attached.`);
      continue;
    }
    if (attachments.length >= MAX_ATTACHMENTS) {
      notices.push(
        `Only ${MAX_ATTACHMENTS} files can be attached per message. Remaining files were skipped.`,
      );
      break;
    }
    const kind = fileKind(file);
    if (!kind) {
      notices.push(`${path}: unsupported format. Choose an image, text, code or CSV file.`);
      continue;
    }
    // A PDF has its own, larger cap: the text inside is a fraction of the file.
    if (kind !== 'pdf' && file.size > (kind === 'image' ? MAX_IMAGE_BYTES : MAX_TEXT_BYTES)) {
      notices.push(`${path}: exceeds the ${kind === 'image' ? '4 MB image' : '2 MB text'} limit.`);
      continue;
    }
    if (kind === 'pdf') {
      const { pdfToText } = await import('./pdfText');
      const read = await pdfToText(file);
      if (read.outcome !== 'ok') {
        // Always says WHICH file and WHY — a PDF is never silently dropped.
        notices.push(`${path}: ${read.note}`);
        continue;
      }
      const attachment: Attachment = { kind: 'pdf', name: file.name, path, key, size: file.size };
      const remaining = Math.max(0, TEXT_BUDGET - textUsed - attachmentText(attachment).length - 16);
      if (!remaining) {
        notices.push(`${path}: text context is full. Send the current files first.`);
        continue;
      }
      attachment.text = read.text.slice(0, Math.min(6000, remaining));
      attachment.shortened = read.shortened || attachment.text.length < read.text.length;
      textUsed += attachmentText(attachment).length;
      if (attachment.shortened) notices.push(`${path}: attached an excerpt of the PDF to fit the message.`);
      seen.add(key);
      attachments.push(attachment);
      continue;
    }
    if (
      kind === 'image' &&
      attachments.filter((item) => item.kind === 'image').length >= MAX_IMAGES
    ) {
      notices.push(`${path}: only ${MAX_IMAGES} images are allowed per message.`);
      continue;
    }
    try {
      const content = await readFile(file, kind === 'image');
      const attachment: Attachment = { kind, name: file.name, path, key, size: file.size };
      if (kind === 'image') {
        if (imageData + content.length > MAX_IMAGE_DATA) {
          notices.push(
            `${path}: the combined image size is too large. Remove an image or use smaller files.`,
          );
          continue;
        }
        attachment.dataUrl = content;
        imageData += content.length;
      } else {
        if (!content.trim() || [...content].some((char) => char.charCodeAt(0) === 0)) {
          notices.push(`${path}: empty or binary file; no readable text was attached.`);
          continue;
        }
        const remaining = Math.max(
          0,
          TEXT_BUDGET - textUsed - attachmentText(attachment).length - 16,
        );
        if (!remaining) {
          notices.push(`${path}: text context is full. Send the current files first.`);
          continue;
        }
        attachment.text = content.slice(0, Math.min(6000, remaining));
        attachment.shortened = attachment.text.length < content.length;
        textUsed += attachmentText(attachment).length;
        if (attachment.shortened)
          notices.push(
            `${path}: attached an excerpt to fit the message. Split the file for a complete review.`,
          );
      }
      seen.add(key);
      attachments.push(attachment);
    } catch {
      notices.push(`${path}: could not read this file. Try selecting it again.`);
    }
  }
  if (hidden) notices.push(`${hidden} hidden or generated files skipped.`);
  if (selection.files.length > SCAN_LIMIT)
    notices.push(
      `Only the first ${SCAN_LIMIT} files were scanned. Select a smaller folder for the rest.`,
    );
  if (cancelled) notices.push(`Stopped after ${attachments.length - existing.length} file${attachments.length - existing.length === 1 ? '' : 's'}. What was read is still attached.`);
  return { attachments, notices, ...(cancelled ? { cancelled: true } : {}) };
}

/** Capture entries before awaiting: browser DataTransfer access ends after drop. */
export async function droppedFiles(transfer: DataTransfer): Promise<FileSelection> {
  const entries = Array.from(transfer.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => ({ entry: item.webkitGetAsEntry?.(), file: item.getAsFile() }));
  if (!entries.length) return pickerFiles(transfer.files);
  const files: SelectedFile[] = [];
  const notices: string[] = [];
  let scanned = 0;
  async function visit(entry: FileSystemEntry, parent = ''): Promise<void> {
    if (scanned >= SCAN_LIMIT) return;
    scanned++;
    const path = `${parent}${entry.name}`;
    if (ignored(path)) return;
    if (entry.isFile) {
      try {
        const file = await new Promise<File>((resolve, reject) =>
          (entry as FileSystemFileEntry).file(resolve, reject),
        );
        files.push({ file, path });
      } catch {
        notices.push(`${path}: could not access file.`);
      }
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      try {
        while (scanned < SCAN_LIMIT) {
          const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
            reader.readEntries(resolve, reject),
          );
          if (!batch.length) break;
          for (const child of batch) await visit(child, `${path}/`);
        }
      } catch {
        notices.push(`${path}: could not access folder.`);
      }
    }
  }
  for (const { entry, file } of entries) {
    if (scanned >= SCAN_LIMIT) break;
    if (entry) await visit(entry);
    else if (file) {
      scanned++;
      files.push({ file, path: file.name });
    }
  }
  if (scanned >= SCAN_LIMIT)
    notices.push(
      `Folder scan stopped at ${SCAN_LIMIT} entries. Select a smaller folder for the rest.`,
    );
  if (!files.length && !notices.length)
    notices.push('No readable files found. Try Upload folder, or select individual files.');
  return { files, notices };
}
