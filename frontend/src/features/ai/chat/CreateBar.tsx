import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ChevronDownIcon, XIcon } from '@/components/Icons';
import { cn } from '@/utils/cn';
import { CheckIcon, ClipIcon, ImageIcon } from './icons';
import type { CreateKind } from './media';
import type { CatalogState } from './models';
import { ProviderLogo } from './ProviderLogo';
import type { MediaModel, MediaPick, ProviderId } from './types';

export interface CreateGroup {
  provider: ProviderId;
  label: string;
  models: MediaModel[];
}

const TITLE: Record<CreateKind, string> = { image: 'Create image', music: 'Create music clip' };

/**
 * 10.3 — the bar above the message box while Create image or Create music
 * clip is on: what the next message will make, the model that will make it
 * (its provider's logo and its own name, chosen from a list grouped by
 * provider), and a × to go back to chatting.
 *
 * The list is a listbox: arrows move, Enter or Space picks, Escape closes.
 */
export function CreateBar({
  kind,
  groups,
  state,
  pick,
  docked,
  onPick,
  onCancel,
}: {
  kind: CreateKind;
  groups: CreateGroup[];
  state: CatalogState;
  pick: MediaPick | null;
  /** The composer sits at the bottom (the list opens upwards). */
  docked: boolean;
  onPick: (pick: MediaPick) => void;
  onCancel: () => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const uid = useId();
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const Icon = kind === 'image' ? ImageIcon : ClipIcon;
  const options = groups.flatMap((g) => g.models.map((m) => ({ provider: g.provider, model: m })));
  const selectedAt = options.findIndex((o) => pick && o.provider === pick.provider && o.model.id === pick.model);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!open) return;
    setActive(selectedAt < 0 ? 0 : selectedAt);
    listRef.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-anchor on open only
  }, [open]);
  const optId = (i: number): string => `${uid}-o-${i}`;
  useEffect(() => {
    if (open) document.getElementById(optId(active))?.scrollIntoView({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, open]);

  const close = (): void => {
    setOpen(false);
    btnRef.current?.focus();
  };
  const choose = (i: number): void => {
    const o = options[i];
    if (!o) return;
    onPick({ provider: o.provider, model: o.model.id, name: o.model.name });
    close();
  };
  const onKey = (e: KeyboardEvent): void => {
    const last = options.length - 1;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i >= last ? 0 : i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i <= 0 ? Math.max(0, last) : i - 1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(Math.max(0, last));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      choose(active);
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  const label = pick?.name ?? (state === 'ready' || state === 'failed' ? 'No model available' : 'Loading models…');
  let at = -1;

  return (
    <div className="ai-create-bar" role="group" aria-label={TITLE[kind]} data-create={kind}>
      <span className="ai-create-kind">
        <Icon className="w-4 h-4" />
        {TITLE[kind]}
      </span>
      <div className="relative min-w-0">
        <button
          ref={btnRef}
          type="button"
          className={cn('ai-create-model', open && 'is-open')}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={`${kind === 'image' ? 'Image' : 'Music'} model: ${label}`}
          disabled={!options.length}
          onClick={() => setOpen((v) => !v)}
        >
          {pick && <ProviderLogo provider={pick.provider} size={16} />}
          <span className="truncate">{label}</span>
          {options.length > 0 && <ChevronDownIcon className={cn('w-3 h-3 shrink-0', open && 'rotate-180')} />}
        </button>
        {open && (
          <>
            <button type="button" aria-label="Close model list" tabIndex={-1} onClick={() => setOpen(false)} className="fixed inset-0 z-40 cursor-default" />
            <div
              ref={listRef}
              role="listbox"
              tabIndex={-1}
              aria-label={`Choose ${kind === 'image' ? 'image' : 'music'} model`}
              aria-activedescendant={optId(active)}
              className={cn('ai-popover ai-pop ai-create-list', docked ? 'is-up' : 'is-down')}
              onKeyDown={onKey}
            >
              {groups.map((g) => (
                <div key={g.provider} role="group" aria-labelledby={`${uid}-h-${g.provider}`}>
                  <p className="ai-model-heading">
                    <span className="ai-model-heading-name">
                      <ProviderLogo provider={g.provider} size={16} />
                      <span id={`${uid}-h-${g.provider}`}>{g.label}</span>
                    </span>
                    <span className="ai-model-count">{g.models.length}</span>
                  </p>
                  {g.models.map((m) => {
                    at += 1;
                    const i = at;
                    const selected = i === selectedAt;
                    return (
                      <div
                        key={m.id}
                        id={optId(i)}
                        role="option"
                        aria-selected={selected}
                        className={cn('ai-model-option', active === i && 'ai-model-option-active')}
                        onClick={() => choose(i)}
                        onMouseMove={() => active !== i && setActive(i)}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="ai-model-label">{m.name}</span>
                          {m.maker && <span className="ai-model-hint">{m.maker}</span>}
                        </span>
                        <span className="ai-model-check" aria-hidden>
                          {selected && <CheckIcon className="w-3.5 h-3.5" />}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
      <span className="flex-1" />
      <button type="button" className="ai-create-x" aria-label={`Stop: ${TITLE[kind]}`} title="Back to chatting" onClick={onCancel}>
        <XIcon className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
