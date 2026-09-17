import { memo, useEffect, useState, type ReactNode } from 'react';
import { SparkleIcon } from '@/components/Icons';
import { buildTodayBrief, type TodayBrief } from '@/features/ai/todayBrief';
import { firstName, timeOfDay } from './storage';

/** The centred greeting on an empty chat: the mark, "Good evening, <first
 *  name>", one quiet line. The composer sits directly beneath it. */
export const Greeting = memo(function Greeting({ userName }: { userName: string }): ReactNode {
  const name = firstName(userName);
  return (
    <div className="ai-column ai-greeting ai-enter">
      <span className="ai-greeting-mark" aria-hidden>
        <SparkleIcon className="w-7 h-7" />
      </span>
      <h2 className="ai-display text-balance">
        Good {timeOfDay()}
        {name && (
          <>
            , <span className="ai-display-name">{name}</span>
          </>
        )}
      </h2>
      <p className="ai-greeting-sub">Where should we take your ideas today?</p>
    </div>
  );
});

export interface QuickAction {
  label: string;
  prompt: string;
  mode?: string;
}

/**
 * Beneath the composer on an empty chat: four quiet suggestions — today's
 * brief first (built on the device: festival, listening so far, taste), then
 * starters to make four — the one-line brief itself, and the shortcuts row
 * (saved prompts and the quick actions that pre-fill the box).
 */
export const Suggestions = memo(function Suggestions({
  starters,
  quickActions,
  onSend,
  onQuick,
  onOpenPrompts,
}: {
  starters: string[];
  quickActions: QuickAction[];
  onSend: (text: string) => void;
  onQuick: (qa: QuickAction) => void;
  onOpenPrompts: () => void;
}): ReactNode {
  const [brief, setBrief] = useState<TodayBrief | null>(null);
  useEffect(() => {
    setBrief(buildTodayBrief());
  }, []);
  const picks: string[] = [];
  for (const p of [...(brief?.prompts ?? []), ...starters]) {
    if (picks.length < 4 && !picks.includes(p)) picks.push(p);
  }
  return (
    <div className="ai-column ai-suggest ai-enter">
      <div className="ai-suggest-grid" role="group" aria-label="Suggestions">
        {picks.map((p) => (
          <button key={p} type="button" onClick={() => onSend(p)} className="ai-suggestion">
            {p}
          </button>
        ))}
      </div>
      {brief && (
        <p className="ai-brief">
          <span className="ai-brief-label">Today for you · {brief.date}</span>
          {brief.lines.length > 0 && <span> — {brief.lines.join(' ')}</span>}
        </p>
      )}
      <div className="ai-scroll-x ai-quick-row" role="group" aria-label="Shortcuts">
        <button type="button" onClick={onOpenPrompts} className="ai-chip ai-chip-quiet shrink-0">
          Saved prompts
        </button>
        {quickActions.map((qa) => (
          <button key={qa.label} type="button" onClick={() => onQuick(qa)} className="ai-chip ai-chip-quiet shrink-0">
            {qa.label}
          </button>
        ))}
      </div>
    </div>
  );
});
