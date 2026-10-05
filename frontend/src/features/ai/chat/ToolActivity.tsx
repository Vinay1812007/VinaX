import { memo, useEffect, useId, useState, type ReactNode } from 'react';
import { ChevronDownIcon, SearchIcon } from '@/components/Icons';
import { cn } from '@/utils/cn';
import { AgentIcon, CheckIcon, CodeIcon, PageIcon, ToolIcon } from './icons';
import { buildTimeline } from './toolTimeline';
import type { AgentStep, AgentTool } from './types';

const STEP_ICON: Record<AgentTool, (p: { className?: string }) => ReactNode> = {
  search: SearchIcon,
  code: CodeIcon,
  visit: PageIcon,
  other: ToolIcon,
};

/** How many source hosts a search row names before "+N". */
const HOST_CHIPS = 4;

/**
 * 10.0 Marigold — the tools a reply used, as a timeline.
 *
 * One row per tool call the stream reported: the tool's icon, what it did
 * ("Searching the web for “…”", "Reading example.com", "Running code") and its
 * status — a spinner while it runs, a check once it is done. The service's own
 * web search is a row too, with the hosts of the pages it returned.
 *
 * While the tools work the group is open and its header names the step in
 * progress; once the answer starts to arrive it folds to one line ("Used 3
 * tools", "Searched the web · 5 sources") that opens again on demand. The fold
 * animates its height with grid rows (0fr → 1fr), and the folded body is inert,
 * so nothing in it can be focused or read while it is closed.
 */
export const ToolActivity = memo(function ToolActivity({
  steps,
  sources,
  working,
  answering,
}: {
  steps?: AgentStep[];
  sources?: string[];
  /** The reply is still in flight. */
  working: boolean;
  /** Answer text has started to arrive. */
  answering: boolean;
}): ReactNode {
  const [open, setOpen] = useState(working && !answering);
  const bodyId = useId();
  // Open while the tools work; fold as soon as the answer starts to arrive
  // (the reader wants the words now), and open again if a new run starts.
  useEffect(() => setOpen(working && !answering), [working, answering]);
  const { rows, summary, running } = buildTimeline({ steps, sources, working, answering });
  if (!rows.length) return null;
  const current = running ? rows.find((r) => r.status === 'running') : undefined;
  return (
    <div className="ai-tools" data-working={working || undefined}>
      <button type="button" className="ai-tools-head" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((v) => !v)}>
        <span className="ai-tools-glyph" aria-hidden>
          {running ? <span className="ai-spinner" /> : <AgentIcon className="w-4 h-4" />}
        </span>
        <span className={cn('ai-tools-title', running && 'ai-shimmer')}>{current ? `${current.label}…` : summary}</span>
        <ChevronDownIcon className={cn('ai-tools-chevron w-3 h-3 shrink-0', open && 'rotate-180')} />
      </button>
      <div id={bodyId} className="ai-tools-body" data-open={open} inert={!open}>
        <div className="ai-tools-clip">
          <ol className="ai-tools-list" aria-label="Tool activity">
            {rows.map((r, i) => {
              const Icon = STEP_ICON[r.tool];
              const extra = r.hosts && r.hosts.length > HOST_CHIPS ? r.hosts.length - HOST_CHIPS : 0;
              return (
                <li key={`${i}-${r.tool}`} className="ai-tool-row" data-status={r.status}>
                  <span className="ai-tool-icon" aria-hidden>
                    <Icon className="w-3.5 h-3.5" />
                  </span>
                  <span className="ai-tool-main">
                    <span className="ai-tool-label">
                      {r.label}
                      {r.sourceCount ? <span className="ai-tool-count"> · {r.sourceCount === 1 ? '1 source' : `${r.sourceCount} sources`}</span> : null}
                    </span>
                    {r.hosts?.length ? (
                      <span className="ai-tool-hosts">
                        {r.hosts.slice(0, HOST_CHIPS).map((h) => (
                          <span key={h} className="ai-host-chip">
                            <span className="ai-host-letter" aria-hidden>
                              {h.charAt(0).toUpperCase()}
                            </span>
                            <span className="ai-host-name">{h}</span>
                          </span>
                        ))}
                        {extra > 0 && <span className="ai-host-chip ai-host-more">+{extra}</span>}
                      </span>
                    ) : null}
                  </span>
                  <span className="ai-tool-status">
                    {r.status === 'running' ? <span className="ai-spinner" aria-hidden /> : <CheckIcon className="w-3.5 h-3.5" />}
                    <span className="sr-only">{r.status === 'running' ? 'In progress' : 'Done'}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </div>
  );
});
