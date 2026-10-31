/**
 * VinaX AI — the composer's + menu: Add photos and files, Web search (Auto,
 * On, Off) when it is offered, Extended thinking, and Voice settings when
 * voice is offered.
 */
import { useRef, useState, type ReactNode } from 'react';
import { moveFocus, useDismiss } from './useDismiss';
import { GlobeSmallIcon, PaperclipIcon, PlusSmallIcon, ThinkIcon, VoiceSettingsIcon } from './icons';

export type WebSearch = 'auto' | 'on' | 'off';
const SEARCH_CHOICES: Array<{ value: WebSearch; label: string; note: string }> = [
  { value: 'auto', label: 'Auto', note: 'Searches when you ask about something current' },
  { value: 'on', label: 'On', note: 'Searches for every message' },
  { value: 'off', label: 'Off', note: 'Never searches' },
];

interface Props {
  thinking: boolean;
  onThinking(v: boolean): void;
  /** Present when web search is offered. */
  search?: { value: WebSearch; onChange(v: WebSearch): void };
  /** Open the file picker. */
  onAddFiles?(): void;
  /** Open Voice settings. */
  onVoiceSettings?(): void;
  disabled?: boolean;
}

export function PlusMenu({ thinking, onThinking, search, onAddFiles, onVoiceSettings, disabled }: Props): ReactNode {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const close = (focus = true) => {
    setOpen(false);
    if (focus) button.current?.focus();
  };
  useDismiss(open, () => close(false), [button, menu]);
  return (
    <div className="vx-ai-plus">
      <button
        ref={button}
        type="button"
        className={`vx-ai-icon-btn${thinking || search?.value === 'on' ? ' is-on' : ''}`}
        aria-label="More options"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          setOpen((o) => !o);
          requestAnimationFrame(() => moveFocus(menu.current, '[role^="menuitem"]', 'first'));
        }}
      >
        <PlusSmallIcon className="w-5 h-5" />
      </button>
      {open && (
        <div
          ref={menu}
          role="menu"
          aria-label="Options"
          className="vx-ai-pop vx-ai-plus-menu"
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); moveFocus(menu.current, '[role^="menuitem"]', 1); }
            if (e.key === 'ArrowUp') { e.preventDefault(); moveFocus(menu.current, '[role^="menuitem"]', -1); }
          }}
        >
          {onAddFiles && (
            <div
              role="menuitem"
              tabIndex={-1}
              className="vx-ai-menu-item"
              onClick={() => { close(false); onAddFiles(); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); close(false); onAddFiles(); } }}
            >
              <PaperclipIcon className="w-4 h-4" />
              <span className="vx-ai-menu-text">
                <span>Add photos and files</span>
                <span className="vx-ai-opt-sub">Images, PDFs, text and code</span>
              </span>
            </div>
          )}
          {search && (
            <div role="group" aria-labelledby="vx-ai-websearch-h">
              <div id="vx-ai-websearch-h" className="vx-ai-pop-head"><GlobeSmallIcon className="w-3.5 h-3.5" /> Web search</div>
              {SEARCH_CHOICES.map((c) => (
                <div
                  key={c.value}
                  role="menuitemradio"
                  aria-checked={search.value === c.value}
                  tabIndex={-1}
                  className="vx-ai-menu-item"
                  onClick={() => search.onChange(c.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); search.onChange(c.value); } }}
                >
                  <span className={`vx-ai-radio${search.value === c.value ? ' is-on' : ''}`} aria-hidden />
                  <span className="vx-ai-menu-text">
                    <span>{c.label}</span>
                    <span className="vx-ai-opt-sub">{c.note}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
          <div
            role="menuitemcheckbox"
            aria-checked={thinking}
            tabIndex={-1}
            className="vx-ai-menu-item"
            onClick={() => onThinking(!thinking)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onThinking(!thinking); } }}
          >
            <ThinkIcon className="w-4 h-4" />
            <span className="vx-ai-menu-text">
              <span>Extended thinking</span>
              <span className="vx-ai-opt-sub">Thinks longer before answering hard questions</span>
            </span>
            <span className={`vx-ai-switch${thinking ? ' is-on' : ''}`} aria-hidden />
          </div>
          {onVoiceSettings && (
            <div
              role="menuitem"
              tabIndex={-1}
              className="vx-ai-menu-item"
              onClick={() => { close(false); onVoiceSettings(); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); close(false); onVoiceSettings(); } }}
            >
              <VoiceSettingsIcon className="w-4 h-4" />
              <span className="vx-ai-menu-text">
                <span>Voice settings</span>
                <span className="vx-ai-opt-sub">Voices for Read aloud and Live voice</span>
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
