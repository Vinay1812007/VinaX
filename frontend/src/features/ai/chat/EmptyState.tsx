import { memo, useEffect, useState, type ReactNode } from 'react';
import { SparkleIcon } from '@/components/Icons';
import { ArrowUpRightIcon } from '@/components/ai/AiExtras';
import { buildTodayBrief, type TodayBrief } from '@/features/ai/todayBrief';
import { firstName, timeOfDay } from './storage';
import { hasMakerLogo, MakerLogo } from './MakerLogo';
import type { MakerFamily } from './chatStyle';

/** The centred greeting on an empty chat: the VinaX sparkle, "Good evening,
 *  <first name>" and one line on what the box can do. The composer sits
 *  directly beneath it. */
export const Greeting = memo(function Greeting({ userName, maker }: { userName: string; maker?: MakerFamily | null }): ReactNode {
  const name = firstName(userName);
  // 11.3.2 — a picked model greets with its maker's logo; Auto with VinaX's mark.
  const showMaker = !!maker && hasMakerLogo(maker);
  return (
    <div className="ai-column ai-greeting ai-enter">
      {showMaker ? (
        <span className="ai-hero-mark ai-hero-mark-maker" aria-hidden>
          <MakerLogo family={maker} size={56} />
        </span>
      ) : (
        <span className="ai-mark ai-hero-mark" aria-hidden>
          <SparkleIcon filled />
        </span>
      )}
      <h2 className="ai-display text-balance">
        Good {timeOfDay()}
        {name && (
          <>
            , <span className="ai-display-name">{name}</span>
          </>
        )}
      </h2>
      <p className="ai-greeting-sub">Ask anything. Ask for music, and the songs come back ready to play.</p>
    </div>
  );
});

export interface QuickAction {
  label: string;
  prompt: string;
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
            <span>{p}</span>
            <ArrowUpRightIcon />
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
