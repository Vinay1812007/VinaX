/**
 * VinaX AI — files as chips: in the composer (with a remove ×, a spinner
 * while one is prepared, its error) and in a sent message (an image's
 * thumbnail, a document's name and pages).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { fileUrl } from './files';
import { CloseIcon, FileIcon } from './icons';
import type { PendingFile } from './usePendingFiles';
import type { FileRef } from './types';

const kindLabel = (f: { kind: FileRef['kind']; pages?: number }): string => (f.kind === 'pdf' ? (f.pages ? `PDF · ${f.pages} page${f.pages === 1 ? '' : 's'}` : 'PDF') : f.kind === 'image' ? 'Image' : 'Text');

function StoredImage({ file }: { file: FileRef }): ReactNode {
  const [url, setUrl] = useState<string | null>(file.preview ?? null);
  useEffect(() => {
    if (file.preview) return;
    let live = true;
    void fileUrl(file.id).then((u) => { if (live) setUrl(u); }).catch(() => undefined);
    return () => { live = false; };
  }, [file.id, file.preview]);
  return url ? (
    <a href={url} target="_blank" rel="noopener noreferrer" className="vx-ai-file-thumb" title={file.name}>
      <img src={url} alt={file.name} />
    </a>
  ) : (
    <span className="vx-ai-file-thumb is-empty" role="img" aria-label={file.name} />
  );
}

/** The files of a sent message. */
export function MessageFiles({ files }: { files: FileRef[] }): ReactNode {
  return (
    <ul className="vx-ai-files" aria-label="Attached files">
      {files.map((f) => (
        <li key={f.id}>
          {f.kind === 'image' ? <StoredImage file={f} /> : (
            <span className="vx-ai-file">
              <FileIcon className="w-5 h-5" />
              <span className="vx-ai-file-text">
                <span className="vx-ai-file-name">{f.name}</span>
                <span className="vx-ai-file-meta">{kindLabel(f)}</span>
              </span>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** The composer's tray. */
export function PendingChips({ files, onRemove }: { files: PendingFile[]; onRemove(key: string): void }): ReactNode {
  if (!files.length) return null;
  return (
    <ul className="vx-ai-files is-tray" aria-label="Files to send">
      {files.map((f) => (
        <li key={f.key} className={f.status === 'error' ? 'is-error' : undefined}>
          <span className="vx-ai-file">
            {f.preview ? <img src={f.preview} alt="" className="vx-ai-file-mini" /> : <FileIcon className="w-5 h-5" />}
            <span className="vx-ai-file-text">
              <span className="vx-ai-file-name">{f.name}</span>
              <span className="vx-ai-file-meta" role={f.status === 'error' ? 'alert' : undefined}>
                {f.status === 'preparing' ? 'Adding…' : f.status === 'error' ? f.error : kindLabel({ kind: f.kind, pages: f.ref?.pages })}
              </span>
            </span>
            <button type="button" className="vx-ai-file-x" onClick={() => onRemove(f.key)} aria-label={`Remove ${f.name}`}>
              <CloseIcon className="w-3.5 h-3.5" />
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}
