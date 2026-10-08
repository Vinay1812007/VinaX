/**
 * 11.2 — how a web-grounded reply shows what it drew on:
 *
 * - SourceChip: a small rounded chip at the end of a sentence the search
 *   backed (a letter monogram and the publication's name; "Name +1" when
 *   several pages back it). Opens the page in a new tab.
 * - SourcesButton / SourcesPanel: "Sources" in the reply's action row opens
 *   a numbered list of every page, with what the model searched for.
 * - SearchSuggestions: the search service's suggestion snippet in a sealed
 *   frame (empty sandbox: no scripts, no same-origin, no navigation). It stays
 *   on show under the reply — showing it next to a grounded answer is a
 *   condition of the free grounding service.
 *
 * No favicons and no remote images: the monogram is a letter.
 */
import { forwardRef, useEffect, useRef, type ReactNode } from 'react';
import { XIcon } from '@/components/Icons';
import { sourceLabel } from './citations';
import { GlobeIcon } from './icons';
import type { MsgSources } from './types';

type Item = MsgSources['items'][number];

const describe = (it: Item): string => {
  const l = sourceLabel(it);
  return [l.pageTitle, l.host].filter(Boolean).join(' — ') || l.name;
};

/** One inline citation: the first page's monogram and name, "+n" for the rest. */
export function SourceChip({ items, sources }: { items: Item[]; sources: number[] }): ReactNode {
  const shown = sources.map((n) => items[n]).filter(Boolean);
  if (!shown.length) return null;
  const first = shown[0];
  const l = sourceLabel(first);
  const more = shown.length - 1;
  const title = shown.map(describe).join('\n');
  return (
    <a
      className="ai-cite"
      href={first.url}
      target="_blank"
      rel="noopener noreferrer"
      title={title}
      aria-label={`Source: ${l.name}${more ? ` and ${more} more` : ''}`}
    >
      <span className="ai-cite-mono" aria-hidden>
        {l.letter}
      </span>
      <span className="ai-cite-name" aria-hidden>
        {l.name}
      </span>
      {more > 0 && (
        <span className="ai-cite-more" aria-hidden>
          +{more}
        </span>
      )}
    </a>
  );
}

/** "Sources" in the reply's action row, with up to three monograms. */
export const SourcesButton = forwardRef<HTMLButtonElement, { s: MsgSources; open: boolean; panelId: string; onToggle: () => void; onClose: () => void }>(
  function SourcesButton({ s, open, panelId, onToggle, onClose }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        className="ai-tool ai-sources-btn"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title={open ? 'Hide sources' : 'Show sources'}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && open) {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <span className="ai-sources-stack" aria-hidden>
          {s.items.slice(0, 3).map((it) => (
            <span key={it.url} className="ai-cite-mono">
              {sourceLabel(it).letter}
            </span>
          ))}
        </span>
        <span className="ai-tool-label">Sources</span>
      </button>
    );
  },
);

/** Every page the reply drew on, numbered, and what the model searched for.
 *  Takes focus when it opens; Escape or Close shuts it (the caller puts focus
 *  back on the button). */
export function SourcesPanel({ s, id, onClose }: { s: MsgSources; id: string; onClose: () => void }): ReactNode {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
    ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, []);
  return (
    <section
      ref={ref}
      id={id}
      className="ai-sources-panel ai-enter"
      role="region"
      aria-label="Sources"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="ai-sources-head">
        <span className="ai-sources-title">
          Sources <span className="ai-sources-count">{s.items.length}</span>
        </span>
        <button type="button" className="ai-tool ai-sources-close" aria-label="Close sources" title="Close" onClick={onClose}>
          <XIcon className="w-4 h-4" />
        </button>
      </div>
      {s.queries.length > 0 && (
        <p className="ai-sources-cap">
          <GlobeIcon className="w-3.5 h-3.5 shrink-0" />
          <span className="min-w-0">
            Searched for: {s.queries.map((q) => `“${q}”`).join(', ')}
          </span>
        </p>
      )}
      {s.items.length > 0 && (
        <ol className="ai-sources-rows">
          {s.items.map((it, k) => {
            const l = sourceLabel(it);
            return (
              <li key={it.url}>
                <a className="ai-sources-row" href={it.url} target="_blank" rel="noopener noreferrer" title={describe(it)}>
                  <span className="ai-sources-num" aria-hidden>
                    {k + 1}
                  </span>
                  <span className="ai-cite-mono" aria-hidden>
                    {l.letter}
                  </span>
                  <span className="ai-sources-text">
                    <span className="ai-sources-name">{l.name}</span>
                    {l.pageTitle && l.pageTitle !== l.name && <span className="ai-sources-page">{l.pageTitle}</span>}
                    {l.host && <span className="ai-sources-host">{l.host}</span>}
                  </span>
                </a>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/** The search service's suggestion snippet, sealed (see the module note). */
export const SearchSuggestions = ({ entry }: { entry: string | null }): ReactNode =>
  entry ? <iframe className="ai-sources-entry" sandbox="" srcDoc={entry} title="Search suggestions" tabIndex={-1} loading="lazy" /> : null;
