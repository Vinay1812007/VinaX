import { useEffect, useRef, useState } from 'react';
import { cn } from '@/utils/cn';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useDismissOnBack } from '@/hooks/useDismissOnBack';
import { type SlashCommand } from '@/features/ai/slashCommands';
import { addPrompt, loadPrompts, removePrompt, type SavedPrompt } from '@/features/ai/savedPrompts';
import { buildTodayBrief, type TodayBrief } from '@/features/ai/todayBrief';
import { REPLY_LANGS, REPLY_STYLES } from '@/features/ai/replyPrefs';

/* v5.16.0 — small companions for the VinaX AI page, kept out of the 1.8k-line
   page module: slash menu, follow-up chips, today brief, saved prompts, and
   the reply-preference bar. */

export function SlashMenu({ items, onPick }: { items: SlashCommand[]; onPick: (c: SlashCommand) => void }) {
  if (!items.length) return null;
  return (
    <div role="listbox" aria-label="Commands" className="absolute left-3 right-3 bottom-full mb-2 glass-modal rounded-2xl p-1.5 shadow-xl max-h-64 overflow-auto z-20">
      {items.map((c) => (
        <button
          key={c.cmd}
          role="option"
          aria-selected={false}
          onMouseDown={(e) => { e.preventDefault(); onPick(c); }}
          className="w-full text-left px-3 py-2 rounded-xl hover:bg-ink-800 flex items-baseline gap-3"
        >
          <span className="font-mono text-[12px] font-bold text-ember-400 shrink-0">/{c.cmd}{c.arg ? ` <${c.arg}>` : ''}</span>
          <span className="text-[12px] text-ink-300 truncate">{c.hint}</span>
        </button>
      ))}
    </div>
  );
}

export function FollowupChips({ items, onPick, disabled }: { items: string[]; onPick: (t: string) => void; disabled?: boolean }) {
  if (!items.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Follow-up suggestions">
      {items.map((t) => (
        <button
          key={t}
          disabled={disabled}
          onClick={() => onPick(t)}
          className="px-3 py-1 rounded-full border border-ink-700 text-[12px] font-semibold text-ink-200 hover:border-ink-400 hover:text-ink-100 disabled:opacity-50"
        >
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
    <div className="w-full max-w-xl mb-5 rounded-2xl border border-glass bg-[var(--tile)] p-4 text-left">
      <p className="text-[10px] font-bold uppercase tracking-widest text-ink-400">Today for you · {brief.date}</p>
      {brief.lines.length > 0 && <p className="mt-1 text-sm text-ink-200">{brief.lines.join(' ')}</p>}
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {brief.prompts.map((p) => (
          <button key={p} onClick={() => onPick(p)} className="px-3 py-1 rounded-full bg-ink-800 hover:bg-ink-700 text-[12px] font-semibold text-ink-100">
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
        <h2 className="text-lg font-bold">Saved prompts</h2>
        <p className="text-xs text-ink-400 mt-0.5 mb-3">Your own library, on this device. Type <b>/prompts</b> in the composer to open it any time.</p>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" className="w-full mb-2 px-3 py-2 rounded-full bg-ink-800 text-sm outline-none placeholder:text-ink-400" />
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="Prompt text…" className="w-full px-3 py-2 rounded-2xl bg-ink-800 text-sm outline-none resize-none placeholder:text-ink-500" />
        <div className="mt-2 flex justify-end">
          <button disabled={!text.trim()} onClick={() => { setList(addPrompt(text, title || undefined)); setTitle(''); setText(''); }} className="btn-primary px-4 py-1.5 text-sm disabled:opacity-50">Save prompt</button>
        </div>
        <div className="mt-3 divide-y divide-ink-800">
          {list.length === 0 && <p className="py-6 text-center text-sm text-ink-400">Nothing saved yet.</p>}
          {list.map((p) => (
            <div key={p.id} className="py-2 flex items-start gap-2">
              <button onClick={() => { onUse(p.text); onClose(); }} className="min-w-0 flex-1 text-left">
                <p className="text-sm font-bold truncate">{p.title}</p>
                <p className="text-xs text-ink-400 line-clamp-2">{p.text}</p>
              </button>
              <button onClick={() => setList(removePrompt(p.id))} aria-label={`Delete ${p.title}`} className="text-xs font-bold text-ink-400 hover:text-ink-100 px-2 py-1">Delete</button>
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
  const sel = 'appearance-none bg-ink-800 hover:bg-ink-700 rounded-full px-2.5 py-1 text-[11px] font-bold text-ink-200 outline-none cursor-pointer';
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-1 pb-1.5 text-[11px]">
      <label className="inline-flex items-center gap-1 text-ink-400">
        Reply in
        <select aria-label="Reply language" value={lang} onChange={(e) => onLang(e.target.value)} className={sel}>
          {REPLY_LANGS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
      </label>
      <label className="inline-flex items-center gap-1 text-ink-400">
        Style
        <select aria-label="Reply style" value={style} onChange={(e) => onStyle(e.target.value)} className={sel}>
          {REPLY_STYLES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </label>
      {hasSong && (
        <button
          onClick={() => onSongCtx(!songCtx)}
          aria-pressed={songCtx}
          title="Let the assistant see the song playing now (title, artist, lyrics)"
          className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-bold transition', songCtx ? 'bg-ember-500/20 text-ember-300 ring-1 ring-ember-400/50' : 'bg-ink-800 text-ink-300 hover:text-ink-100')}
        >
          🎵 Now playing {songCtx ? 'on' : 'off'}
        </button>
      )}
    </div>
  );
}
