import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { SearchIcon } from '@/components/Icons';
import { cn } from '@/utils/cn';
import { CheckIcon } from './icons';
import { buildModelMenu, choiceKey, type CatalogState, type MenuRow } from './models';
import type { CatalogGroup, ModelChoice } from './types';

export interface ModelMenuProps {
  state: CatalogState;
  groups: CatalogGroup[];
  current: ModelChoice;
  recents: ModelChoice[];
  /** Agent mode: only agent-capable models are offered. */
  agentOnly: boolean;
  onPick: (choice: ModelChoice) => void;
  onClose: () => void;
  onRetry: () => void;
  className?: string;
  /** Viewport placement for the floating menu (see placeMenu). */
  style?: CSSProperties;
}

/**
 * v7.1 — the one model menu: a search field over every engine VinaX can
 * reach. Recently used first, then the recommended seats, the pinned VinaX
 * engines, and one section per live catalogue listing every model in it.
 *
 * It is a combobox driving a listbox: focus stays in the search field, the
 * arrow keys move an "active" option (aria-activedescendant), Enter picks it,
 * Escape closes, and typing anywhere filters. `aria-selected` marks the model
 * that is currently in use — the checked row — not the keyboard cursor.
 */
export function ModelMenu({ state, groups, current, recents, agentOnly, onPick, onClose, onRetry, className, style }: ModelMenuProps): ReactNode {
  const [query, setQuery] = useState('');
  const uid = useId();
  const listId = `${uid}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const sections = useMemo(() => buildModelMenu({ groups, state, query, agentOnly, recents }), [groups, state, query, agentOnly, recents]);
  const rows = useMemo(() => sections.flatMap((s) => s.rows), [sections]);
  const currentKey = choiceKey(current);

  // The keyboard cursor. Starts on the model in use; a new search starts at
  // the top of the results.
  const [active, setActive] = useState(0);
  useEffect(() => {
    const at = query ? 0 : rows.findIndex((r) => choiceKey(r.choice) === currentKey);
    setActive(at < 0 ? 0 : at);
    // Re-anchor only when the result set changes shape, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, rows.length, agentOnly]);

  // Focus: the search field on a keyboard device. On touch, focusing a text
  // field would throw the on-screen keyboard over the list being opened, so
  // the list itself takes focus and typing is one tap away.
  useEffect(() => {
    const fine = typeof window.matchMedia !== 'function' || window.matchMedia('(pointer: fine)').matches;
    (fine ? inputRef.current : listRef.current)?.focus({ preventScroll: true });
  }, []);

  const activeRow: MenuRow | undefined = rows[active];
  const optionDomId = (row: MenuRow): string => `${uid}-opt-${row.id.replace(/[^\w-]/g, '_')}`;
  useEffect(() => {
    if (!activeRow) return;
    document.getElementById(optionDomId(activeRow))?.scrollIntoView({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRow?.id]);

  const onKeyDown = (e: KeyboardEvent): void => {
    const last = rows.length - 1;
    if (e.key === 'Escape') {
      // Handled here so the page's own Escape (stop the reply) stays out of it.
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (last < 0 ? 0 : i >= last ? 0 : i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (last < 0 ? 0 : i <= 0 ? last : i - 1));
    } else if (e.key === 'Home' && (e.target !== inputRef.current || !query)) {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End' && (e.target !== inputRef.current || !query)) {
      e.preventDefault();
      setActive(Math.max(0, last));
    } else if (e.key === 'PageDown') {
      e.preventDefault();
      setActive((i) => Math.min(Math.max(0, last), i + 8));
    } else if (e.key === 'PageUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 8));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeRow) onPick(activeRow.choice);
    } else if (e.key === 'Tab') {
      // A popover, not a dialog: Tab leaves it, and leaving closes it.
      onClose();
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.target !== inputRef.current) {
      // Type-to-filter from anywhere in the menu: moving focus during keydown
      // sends the character itself to the search field.
      inputRef.current?.focus();
    }
  };

  return (
    <div className={cn('ai-model-menu ai-popover', className)} style={style} onKeyDown={onKeyDown}>
      <label className="ai-model-search">
        <SearchIcon className="w-3.5 h-3.5 shrink-0 ai-t3" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeRow ? optionDomId(activeRow) : undefined}
          aria-label="Search models"
          placeholder={agentOnly ? 'Search agent models' : 'Search models'}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="done"
        />
        {agentOnly && <span className="ai-badge ai-badge-accent shrink-0">Agent</span>}
      </label>
      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label={agentOnly ? 'Choose agent model' : 'Choose model'}
        tabIndex={-1}
        className="ai-model-list"
      >
        {sections.map((s) => (
          <div key={s.id} role="group" aria-labelledby={`${uid}-h-${s.id}`}>
            <p id={`${uid}-h-${s.id}`} className="ai-model-heading">
              <span>{s.title}</span>
              {s.rows.length > 0 && <span className="ai-model-count">{s.rows.length}</span>}
            </p>
            {s.rows.map((row) => {
              const selected = choiceKey(row.choice) === currentKey;
              return (
                <div
                  key={row.id}
                  id={optionDomId(row)}
                  role="option"
                  aria-selected={selected}
                  className={cn('ai-model-option', activeRow?.id === row.id && 'ai-model-option-active')}
                  onClick={() => onPick(row.choice)}
                  onMouseMove={() => {
                    const i = rows.indexOf(row);
                    if (i !== active) setActive(i);
                  }}
                >
                  <span className="min-w-0 flex-1">
                    <span className={cn('block truncate', row.mono ? 'font-mono text-[12px]' : 'text-[13px] font-bold')}>{row.label}</span>
                    {row.hint && <span className="block truncate text-[11px] font-medium ai-t3">{row.hint}</span>}
                  </span>
                  {row.agent && <span className="ai-badge ai-badge-accent">Agent</span>}
                  {row.badge && <span className="ai-badge">{row.badge}</span>}
                  <span className="ai-model-check" aria-hidden>
                    {selected && <CheckIcon className="w-3.5 h-3.5" />}
                  </span>
                </div>
              );
            })}
            {s.note &&
              (s.retry ? (
                <button type="button" onClick={onRetry} className="ai-model-note ai-model-note-btn">
                  {s.note}
                </button>
              ) : (
                <p className="ai-model-note" role={s.id === 'none' ? 'status' : undefined}>
                  {s.note}
                </p>
              ))}
          </div>
        ))}
      </div>
      <p className="ai-model-foot" aria-hidden>
        <kbd>↑</kbd>
        <kbd>↓</kbd> to move · <kbd>Enter</kbd> to choose · <kbd>Esc</kbd> to close
      </p>
    </div>
  );
}
