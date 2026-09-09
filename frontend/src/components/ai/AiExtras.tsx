import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/utils/cn';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useDismissOnBack } from '@/hooks/useDismissOnBack';
import { ChevronDownIcon, XIcon } from '@/components/Icons';
import { type SlashCommand } from '@/features/ai/slashCommands';
import { addPrompt, loadPrompts, removePrompt, type SavedPrompt } from '@/features/ai/savedPrompts';
import { buildTodayBrief, type TodayBrief } from '@/features/ai/todayBrief';
import { REPLY_LANGS, REPLY_STYLES } from '@/features/ai/replyPrefs';

/* v5.16.0 — small companions for the VinaX AI page, kept out of the 1.8k-line
   page module: slash menu, follow-up chips, today brief, saved prompts, the
   reply-preference bar and (v5.18.0) the message-toolbar "More" popover plus
   the small icon set the toolbar uses. Presentation only — every handler is
   passed in by the page. */

interface IconProps { className?: string }
const stroke = (className?: string) => ({
  className: className ?? 'w-3.5 h-3.5',
  viewBox: '0 0 24 24',
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
});
export const CopyIcon = ({ className }: IconProps): ReactNode => (
  <svg {...stroke(className)}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></svg>
);
export const ThumbUpIcon = ({ className }: IconProps): ReactNode => (
  <svg {...stroke(className)}><path d="M7 10v11H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h3zm0 0l4-7a2 2 0 0 1 2 2v4h5a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 16.8 21H7" /></svg>
);
export const ThumbDownIcon = ({ className }: IconProps): ReactNode => (
  <svg {...stroke(className)}><path d="M17 14V3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-3zm0 0l-4 7a2 2 0 0 1-2-2v-4H6a2 2 0 0 1-2-2.3l1.2-7A2 2 0 0 1 7.2 3H17" /></svg>
);
export const RefreshIcon = ({ className }: IconProps): ReactNode => (
  <svg {...stroke(className)}><path d="M20 11a8 8 0 0 0-14.5-4.5L4 8" /><path d="M4 3v5h5" /><path d="M4 13a8 8 0 0 0 14.5 4.5L20 16" /><path d="M20 21v-5h-5" /></svg>
);
export const ContinueIcon = ({ className }: IconProps): ReactNode => (
  <svg {...stroke(className)}><path d="M5 12h14" /><path d="M13 6l6 6-6 6" /></svg>
);
export const ShortenIcon = ({ className }: IconProps): ReactNode => (
  <svg {...stroke(className)}><path d="M4 7h16M4 12h10M4 17h6" /></svg>
);
export const ExpandIcon = ({ className }: IconProps): ReactNode => (
  <svg {...stroke(className)}><path d="M4 7h16M4 12h16M4 17h16" /></svg>
);
export const SimplifyIcon = ({ className }: IconProps): ReactNode => (
  <svg {...stroke(className)}><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" /><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" /></svg>
);
export const SpeakerIcon = ({ className }: IconProps): ReactNode => (
  <svg {...stroke(className)}><path d="M4 10v4h3l5 4V6L7 10H4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /></svg>
);
export const PinIcon = ({ className }: IconProps): ReactNode => (
  <svg {...stroke(className)}><path d="M9 4h6l-1 5 3 3v2H7v-2l3-3z" /><path d="M12 14v7" /></svg>
);
export const BranchIcon = ({ className }: IconProps): ReactNode => (
  <svg {...stroke(className)}><circle cx="6" cy="6" r="2.5" /><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="8" r="2.5" /><path d="M6 8.5v7M18 10.5c0 3-3 4-6 4.5s-6 1.5-6 3" /></svg>
);
export const PencilIcon = ({ className }: IconProps): ReactNode => (
  <svg {...stroke(className)}><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z" /><path d="M13.5 6.5l3 3" /></svg>
);
export const StarIcon = ({ className, filled }: IconProps & { filled?: boolean }): ReactNode => (
  <svg {...stroke(className)} fill={filled ? 'currentColor' : 'none'}><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L12 16.9l-5.3 2.8 1.1-5.9-4.3-4.1 5.9-.8z" /></svg>
);
export const ArrowUpRightIcon = ({ className }: IconProps): ReactNode => (
  <svg {...stroke(className)}><path d="M7 17L17 7" /><path d="M8 7h9v9" /></svg>
);

export function SlashMenu({ items, onPick }: { items: SlashCommand[]; onPick: (c: SlashCommand) => void }) {
  if (!items.length) return null;
  return (
    <div role="listbox" aria-label="Commands" className="ai-popover absolute left-2 right-2 bottom-full mb-2 max-h-64 overflow-auto z-20 animate-fade-up">
      <p className="px-2.5 pt-1.5 pb-1 text-[10px] font-bold uppercase tracking-widest ai-t3">Commands</p>
      {items.map((c) => (
        <button
          key={c.cmd}
          role="option"
          aria-selected={false}
          onMouseDown={(e) => { e.preventDefault(); onPick(c); }}
          className="ai-menu-item items-baseline"
        >
          <span className="font-mono text-[12px] font-bold text-ember-400 shrink-0">/{c.cmd}{c.arg ? ` <${c.arg}>` : ''}</span>
          <span className="text-[12px] font-medium ai-t3 truncate">{c.hint}</span>
        </button>
      ))}
    </div>
  );
}

export function FollowupChips({ items, onPick, disabled }: { items: string[]; onPick: (t: string) => void; disabled?: boolean }) {
  if (!items.length) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Follow-up suggestions">
      {items.map((t) => (
        <button key={t} disabled={disabled} onClick={() => onPick(t)} className="ai-chip">
          <ArrowUpRightIcon className="w-3 h-3 text-ember-400 shrink-0" />
          {t}
        </button>
      ))}
    </div>
  );
}

export function TodayBriefCard({ onPick }: { onPick: (t: string) => void }) {
  const [brief, setBrief] = useState<TodayBrief | null>(null);
  useEffect(() => { setBrief(buildTodayBrief()); }, []);
  if (!brief) return null;
  return (
    <div className="ai-card w-full p-4 sm:p-5 text-left">
      <div className="flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-ember-400 shrink-0" aria-hidden />
        <p className="text-[10px] font-bold uppercase tracking-widest ai-t3">Today for you · {brief.date}</p>
      </div>
      {brief.lines.length > 0 && <p className="mt-1.5 text-[14px] leading-relaxed ai-t2">{brief.lines.join(' ')}</p>}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {brief.prompts.map((p) => (
          <button key={p} onClick={() => onPick(p)} className="ai-chip">
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SavedPromptsSheet({ onClose, onUse, draft }: { onClose(): void; onUse: (t: string) => void; draft: string }) {
  const [list, setList] = useState<SavedPrompt[]>(() => loadPrompts());
  const [title, setTitle] = useState('');
  const [text, setText] = useState(draft);
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, true, onClose);
  useDismissOnBack(true, onClose);
  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-6" onClick={onClose}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label="Saved prompts" className="w-full sm:max-w-lg glass-modal rounded-t-3xl sm:rounded-3xl p-5 animate-fade-up max-h-[85vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold tracking-tight">Saved prompts</h2>
            <p className="text-xs ai-t3 mt-0.5">Your own library, on this device. Type <b className="ai-t2">/prompts</b> in the composer to open it any time.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="ai-icon-btn -mr-2 -mt-1"><XIcon className="w-4 h-4" /></button>
        </div>
        <div className="mt-4 space-y-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" className="ai-field w-full px-3.5 py-2.5 text-sm outline-none placeholder:ai-t3" />
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="Prompt text…" className="ai-field w-full px-3.5 py-2.5 text-sm outline-none resize-none placeholder:ai-t3" />
        </div>
        <div className="mt-2.5 flex justify-end">
          <button disabled={!text.trim()} onClick={() => { setList(addPrompt(text, title || undefined)); setTitle(''); setText(''); }} className="btn-primary rounded-xl px-4 py-2 text-sm disabled:opacity-50">Save prompt</button>
        </div>
        <div className="mt-4 space-y-1">
          {list.length === 0 && (
            <div className="ai-card py-8 text-center">
              <p className="text-sm font-semibold ai-t2">Nothing saved yet.</p>
              <p className="text-xs ai-t3 mt-1">Prompts you save show up here.</p>
            </div>
          )}
          {list.map((p) => (
            <div key={p.id} className="group flex items-start gap-2 rounded-xl px-2.5 py-2 hover:bg-[var(--ai-hover)] transition-colors">
              <button onClick={() => { onUse(p.text); onClose(); }} className="min-w-0 flex-1 text-left">
                <p className="text-sm font-bold truncate">{p.title}</p>
                <p className="text-xs ai-t3 line-clamp-2 leading-relaxed">{p.text}</p>
              </button>
              <button onClick={() => setList(removePrompt(p.id))} aria-label={`Delete ${p.title}`} className="ai-tool mt-0.5 shrink-0">Delete</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ReplyPrefsBar({
  lang, style, songCtx, hasSong, onLang, onStyle, onSongCtx,
}: { lang: string; style: string; songCtx: boolean; hasSong: boolean; onLang: (v: string) => void; onStyle: (v: string) => void; onSongCtx: (v: boolean) => void }) {
  // v5.25.0 — these three lived on a permanently-visible strip above the
  // composer, where they were three more dropdowns competing with the input.
  // They are set once and rarely changed, so they belong in the settings
  // menu; this renders as menu rows, not as a toolbar.
  return (
    <div aria-label="Reply preferences">
      <label className="ai-menu-item justify-between cursor-pointer">
        <span>Reply in</span>
        <span className="flex items-center gap-1 ai-t1">
          <select aria-label="Reply language" value={lang} onChange={(e) => onLang(e.target.value)} className="ai-select font-semibold text-right">
            {REPLY_LANGS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
          <ChevronDownIcon className="w-3 h-3 pointer-events-none opacity-60" />
        </span>
      </label>
      <label className="ai-menu-item justify-between cursor-pointer">
        <span>Style</span>
        <span className="flex items-center gap-1 ai-t1">
          <select aria-label="Reply style" value={style} onChange={(e) => onStyle(e.target.value)} className="ai-select font-semibold text-right">
            {REPLY_STYLES.map((st) => <option key={st.id} value={st.id}>{st.label}</option>)}
          </select>
          <ChevronDownIcon className="w-3 h-3 pointer-events-none opacity-60" />
        </span>
      </label>
      {hasSong && (
        <button
          onClick={() => onSongCtx(!songCtx)}
          aria-pressed={songCtx}
          title="Let the assistant see the song playing now (title, artist, lyrics)"
          className="ai-menu-item justify-between"
        >
          <span>Use the song playing now</span>
          <span className={cn('text-[11px] font-bold', songCtx ? 'text-ember-400' : 'ai-t3')}>{songCtx ? 'On' : 'Off'}</span>
        </button>
      )}
    </div>
  );
}

/** One entry in the message toolbar's "More" popover. */
export interface MoreAction {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  active?: boolean;
  title?: string;
}

/** v5.18.0 — compact popover holding the long tail of reply actions. Pure
 *  presentation: the page hands in the same handlers it always used. Opens
 *  upward so it never falls below the composer on the last reply. */
export function MoreMenu({ actions }: { actions: MoreAction[] }) {
  const [open, setOpen] = useState(false);
  if (!actions.length) return null;
  return (
    <div className="relative" onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More actions"
        className="ai-tool"
      >
        More
        <ChevronDownIcon className={cn('w-3 h-3 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <>
          <button aria-label="Close menu" tabIndex={-1} onClick={() => setOpen(false)} className="fixed inset-0 z-40 cursor-default" />
          <div role="menu" aria-label="More actions" className="ai-popover absolute left-0 bottom-full mb-1.5 z-50 w-48 animate-fade-up">
            {actions.map((a) => (
              <button
                key={a.label}
                role="menuitem"
                title={a.title}
                aria-pressed={a.active}
                onClick={() => { setOpen(false); a.onClick(); }}
                className="ai-menu-item"
              >
                <span className="ai-t3 shrink-0 [&>svg]:w-4 [&>svg]:h-4">{a.icon}</span>
                <span className="truncate">{a.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
