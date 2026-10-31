/**
 * VinaX AI — what a reply found on the web: the [n] chips in its text (hover,
 * focus or long-press shows the source; a click opens it), the Sources row
 * under it, and, for Google Search grounding, Google's search suggestions in
 * a sandboxed frame (a condition of the free service).
 */
import { useRef, useState, type ReactNode } from 'react';
import type { SearchStatus, Source, SourcesInfo } from './types';

const monogram = (site: string): string => (site.replace(/^www\./, '')[0] ?? '?').toUpperCase();

export function CitationChip({ source }: { source: Source }): ReactNode {
  const [open, setOpen] = useState(false);
  const press = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const tipId = `vx-cite-${source.n}-${source.url.length}`;
  return (
    <span className="vx-ai-cite-wrap" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <a
        className="vx-ai-cite"
        href={source.url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        aria-label={`Source ${source.n}: ${source.title}, ${source.site}`}
        aria-describedby={open ? tipId : undefined}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onTouchStart={() => {
          held.current = false;
          press.current = setTimeout(() => { held.current = true; setOpen(true); }, 450);
        }}
        onTouchEnd={() => { if (press.current) clearTimeout(press.current); }}
        onClick={(e) => {
          // A long-press shows the source instead of opening it.
          if (held.current) { e.preventDefault(); held.current = false; }
        }}
        onContextMenu={(e) => { if (held.current) e.preventDefault(); }}
      >
        {source.n}
      </a>
      {open && (
        <span role="tooltip" id={tipId} className="vx-ai-cite-tip">
          <span className="vx-ai-cite-tip-title">{source.title}</span>
          <span className="vx-ai-cite-tip-site">{source.site}</span>
          {source.snippet && <span className="vx-ai-cite-tip-snip">{source.snippet}</span>}
        </span>
      )}
    </span>
  );
}

export function SourcesRow({ sources }: { sources: SourcesInfo }): ReactNode {
  if (!sources.items.length) return null;
  return (
    <section className="vx-ai-sources" aria-label="Sources">
      <h3 className="vx-ai-sources-h">Sources</h3>
      <ol>
        {sources.items.map((s) => (
          <li key={s.n}>
            <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" title={s.title}>
              <span className="vx-ai-mono" aria-hidden>{monogram(s.site)}</span>
              <span className="vx-ai-src-n">{s.n}</span>
              <span className="vx-ai-src-title">{s.title}</span>
              <span className="vx-ai-src-site">{s.site}</span>
            </a>
          </li>
        ))}
      </ol>
      {sources.entryPointHtml && (
        <iframe
          className="vx-ai-gsearch"
          title="Google Search suggestions"
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          srcDoc={`<!doctype html><meta charset="utf-8"><base target="_blank"><style>html,body{margin:0;background:transparent;overflow-x:auto}</style>${sources.entryPointHtml}`}
        />
      )}
    </section>
  );
}

export function statusText(s: SearchStatus): string {
  if (s.step === 'searching') return `Searching the web for “${s.query.length > 80 ? `${s.query.slice(0, 77)}…` : s.query}”`;
  if (!s.count) return 'No useful results; answering without them';
  return `Found ${s.count} result${s.count === 1 ? '' : 's'}${s.sites.length ? ` · ${s.sites.slice(0, 3).join(', ')}` : ''}`;
}

export function SearchStatusLine({ status }: { status: SearchStatus }): ReactNode {
  return (
    <p className="vx-ai-status" role="status">
      <span className={status.step === 'searching' ? 'vx-ai-shimmer' : undefined}>{statusText(status)}</span>
    </p>
  );
}
