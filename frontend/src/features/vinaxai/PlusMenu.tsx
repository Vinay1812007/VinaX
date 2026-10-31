/**
 * VinaX AI — the composer's + menu. Today it holds Extended thinking; web
 * search and attachments join it in later phases.
 */
import { useRef, useState, type ReactNode } from 'react';
import { moveFocus, useDismiss } from './useDismiss';
import { PlusSmallIcon, ThinkIcon } from './icons';

export function PlusMenu({ thinking, onThinking, disabled }: { thinking: boolean; onThinking(v: boolean): void; disabled?: boolean }): ReactNode {
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
        className={`vx-ai-icon-btn${thinking ? ' is-on' : ''}`}
        aria-label="More options"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          setOpen((o) => !o);
          requestAnimationFrame(() => moveFocus(menu.current, '[role="menuitemcheckbox"]', 'first'));
        }}
      >
        <PlusSmallIcon className="w-5 h-5" />
      </button>
      {open && (
        <div ref={menu} role="menu" aria-label="Options" className="vx-ai-pop vx-ai-plus-menu">
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
        </div>
      )}
    </div>
  );
}
