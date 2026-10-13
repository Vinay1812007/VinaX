import { memo, useEffect, useState, type ReactNode } from 'react';
import { SparkleIcon } from '@/components/Icons';
import { ArrowUpRightIcon } from '@/components/ai/AiExtras';
import { buildTodayBrief, type TodayBrief } from '@/features/ai/todayBrief';
import { firstName, timeOfDay } from './storage';
import { siteName } from './citations';
import { headlinePrompt, loadHeadlines, type Headline } from './headlines';
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
      <TrendingNow onSend={onSend} />
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

/**
 * 11.9 — "Trending now": a few current headlines (India news and tech), the
 * same for everyone, refreshed by the server every few hours. Tapping one asks
 * VinaX AI about it, which searches the web for the latest. Hidden when there
 * are none (switched off, not set up, or the request failed). Letter
 * monograms only — no remote images.
 */
export function TrendingNow({ onSend }: { onSend: (text: string) => void }): ReactNode {
  const [items, setItems] = useState<Headline[]>([]);
  useEffect(() => {
    let live = true;
    void loadHeadlines().then((h) => {
      if (live) setItems(h);
    });
    return () => {
      live = false;
    };
  }, []);
  if (!items.length) return null;
  return (
    <section className="ai-trending" aria-label="Trending now">
      <h2 className="ai-trending-label">Trending now</h2>
      <div className="ai-scroll-x ai-trending-row" role="group" aria-label="Trending headlines">
        {items.map((h) => {
          const name = siteName(h.site);
          return (
            <button key={h.url} type="button" className="ai-trending-card" onClick={() => onSend(headlinePrompt(h))} title={`Ask VinaX AI about this — ${h.site}`}>
              <span className="ai-trending-topic">{h.topic}</span>
              <span className="ai-trending-title">{h.title}</span>
              <span className="ai-trending-site">
                <span className="ai-cite-mono" aria-hidden>
                  {name.charAt(0).toUpperCase()}
                </span>
                {name}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
