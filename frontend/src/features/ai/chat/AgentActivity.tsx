import { memo, useEffect, useId, useState, type ReactNode } from 'react';
import { ChevronDownIcon, SearchIcon } from '@/components/Icons';
import { cn } from '@/utils/cn';
import { AgentIcon, CodeIcon, PageIcon, ToolIcon } from './icons';
import { summariseSteps } from './streamReducer';
import type { AgentStep, AgentTool } from './types';

const STEP_ICON: Record<AgentTool, (p: { className?: string }) => ReactNode> = {
  search: SearchIcon,
  code: CodeIcon,
  visit: PageIcon,
  other: ToolIcon,
};

/**
 * What an agentic engine did on the way to its reply. While the reply
 * streams it is an open "Working…" list, one row per step, newest last; when
 * the answer finishes it folds to one line ("Searched the web · ran code ·
 * 4 steps") that opens again on demand.
 */
export const AgentActivity = memo(function AgentActivity({ steps, working }: { steps: AgentStep[]; working: boolean }): ReactNode {
  const [open, setOpen] = useState(working);
  const listId = useId();
  // Fold when the answer finishes; open again if a new run starts.
  useEffect(() => setOpen(working), [working]);
  if (!steps.length) return null;
  return (
    <div className="ai-activity" data-working={working || undefined}>
      <button type="button" className="ai-activity-head" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((v) => !v)}>
        <AgentIcon className={cn('w-3.5 h-3.5 shrink-0 text-ember-400', working && 'ai-pulse')} />
        <span className="min-w-0 text-left">{working ? 'Working…' : summariseSteps(steps)}</span>
        {working && <span className="ai-t3 font-medium shrink-0">{steps.length}</span>}
        <ChevronDownIcon className={cn('ai-activity-chevron w-3 h-3 shrink-0', open && 'rotate-180')} />
      </button>
      {open && (
        <ol id={listId} className="ai-activity-list" aria-label="Agent activity">
          {steps.map((s, i) => {
            const Icon = STEP_ICON[s.tool];
            return (
              <li key={`${i}-${s.label}`} className="ai-activity-row">
                <Icon className="w-3.5 h-3.5 shrink-0 ai-t3" />
                <span className="min-w-0">{s.label}</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
});
