/**
 * VinaX AI — the model picker in the composer: Auto first, then the curated
 * groups, each model with a one-line description and badges. Models that
 * cannot answer now are shown greyed with the reason.
 */
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { moveFocus, useDismiss } from './useDismiss';
import { ChevronDownSmallIcon } from './icons';
import type { PickerModel } from './types';

export const GROUP_LABELS: Record<PickerModel['group'], string> = {
  fast: 'Fast', balanced: 'Balanced', smart: 'Smart', vision: 'Vision', code: 'Code', cloudflare: 'Cloudflare',
};

const REASONS: Record<NonNullable<PickerModel['reason']>, string> = { busy: 'Busy right now', not_configured: 'Not available' };

export function badgesOf(m: PickerModel): string[] {
  const out: string[] = [];
  if (m.flags.vision) out.push('Vision');
  if (m.flags.web) out.push('Web');
  if (m.flags.thinking) out.push('Thinking');
  if (m.flags.code) out.push('Code');
  return out;
}

interface Props {
  models: PickerModel[];
  value: string;
  onChange(id: string): void;
  disabled?: boolean;
}

export function ModelPicker({ models, value, onChange, disabled }: Props): ReactNode {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = (focus = true) => {
    setOpen(false);
    if (focus) button.current?.focus();
  };
  useDismiss(open, () => close(false), [button, list]);
  const current = models.find((m) => m.id === value);
  const label = value === 'auto' || !current ? 'Auto' : current.name;
  const groups = [...new Set(models.map((m) => m.group))];

  const choose = (m: string, enabled: boolean) => {
    if (!enabled) return;
    onChange(m);
    close();
  };
  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveFocus(list.current, '[role="option"]', 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveFocus(list.current, '[role="option"]', -1); }
    else if (e.key === 'Home') { e.preventDefault(); moveFocus(list.current, '[role="option"]', 'first'); }
    else if (e.key === 'End') { e.preventDefault(); moveFocus(list.current, '[role="option"]', 'last'); }
    else if (e.key === 'Tab') close(false);
  };
  const opened = () => {
    setOpen(true);
    requestAnimationFrame(() => {
      const sel = list.current?.querySelector<HTMLElement>('[aria-selected="true"]');
      (sel ?? list.current?.querySelector<HTMLElement>('[role="option"]'))?.focus();
    });
  };

  const option = (key: string, name: string, sub: string, badges: string[], enabled: boolean, reason?: string) => (
    <div
      key={key}
      role="option"
      tabIndex={-1}
      aria-selected={value === key}
      aria-disabled={!enabled || undefined}
      className="vx-ai-opt"
      onClick={() => choose(key, enabled)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(key, enabled); } }}
    >
      <span className="vx-ai-opt-name">{name}</span>
      <span className="vx-ai-opt-sub">{reason ?? sub}</span>
      {badges.length > 0 && (
        <span className="vx-ai-badges">
          {badges.map((b) => <span key={b} className="vx-ai-badge">{b}</span>)}
        </span>
      )}
    </div>
  );

  return (
    <div className="vx-ai-picker">
      <button
        ref={button}
        type="button"
        className="vx-ai-picker-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-label={`Model: ${label}`}
        disabled={disabled}
        onClick={() => (open ? close() : opened())}
        onKeyDown={(e) => { if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !open) { e.preventDefault(); opened(); } }}
      >
        <span>{label}</span>
        <ChevronDownSmallIcon className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div ref={list} id={`${id}-list`} role="listbox" aria-label="Choose a model" className="vx-ai-pop vx-ai-picker-list" onKeyDown={onListKey}>
          {option('auto', 'Auto', 'Picks a model for each message, and moves on if one is busy', [], true)}
          {groups.map((g) => (
            <div key={g} role="group" aria-labelledby={`${id}-${g}`}>
              <div id={`${id}-${g}`} className="vx-ai-pop-head">{GROUP_LABELS[g]}</div>
              {models.filter((m) => m.group === g).map((m) =>
                option(m.id, m.name, `${m.description}${m.description ? ' · ' : ''}${m.provider}`, badgesOf(m), m.available, m.available ? undefined : REASONS[m.reason ?? 'not_configured']),
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
