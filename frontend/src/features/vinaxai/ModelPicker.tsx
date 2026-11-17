/**
 * VinaX AI — the model picker in the composer: Auto first, then the curated
 * groups, each model with a one-line description and badges. Models that
 * cannot answer now are shown greyed with the reason; Claude models this
 * account may not use are shown locked. A long list gets a
 * search box above it (name, provider or description); ↓ moves into the list.
 * Filter chips narrow the list by capability (Recommended, Fast, Reasoning,
 * Code, Vision, Long context), from what the Worker says each model has.
 */
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { moveFocus, useDismiss } from './useDismiss';
import { ChevronDownSmallIcon } from './icons';
import type { ModelKind, PickerModel } from './types';

export const GROUP_LABELS: Record<PickerModel['group'], string> = {
  fast: 'Fast', balanced: 'Balanced', smart: 'Smart', vision: 'Vision', code: 'Code', claude: 'Claude', more: 'More models', cloudflare: 'Cloudflare',
};

/** More models than this and the picker gets a search box. */
export const SEARCH_FROM = 12;

const REASONS: Record<NonNullable<PickerModel['reason']>, string> = { busy: 'Busy right now', not_configured: 'Not available', locked: 'Locked: Claude is not open to this account' };

export function badgesOf(m: PickerModel): string[] {
  const out: string[] = [];
  if (m.locked) out.push('Locked');
  if (m.flags.vision) out.push('Vision');
  if (m.flags.pdf) out.push('PDF');
  if (m.flags.web) out.push('Web');
  if (m.thinkingLevels?.includes('max')) out.push('Max thinking');
  else if (m.thinkingLevels?.includes('extended')) out.push('Extended thinking');
  else if (m.flags.thinking) out.push('Thinking');
  if (m.flags.code) out.push('Code');
  return out;
}

export type PickerFilter = 'all' | 'recommended' | ModelKind;
export const FILTER_LABELS: Record<PickerFilter, string> = {
  all: 'All', recommended: 'Recommended', fast: 'Fast', reasoning: 'Reasoning', code: 'Code', vision: 'Vision', long: 'Long context',
};
const FILTERS: readonly PickerFilter[] = ['all', 'recommended', 'fast', 'reasoning', 'code', 'vision', 'long'];

/** Models in a capability filter. */
export function filterModels(models: PickerModel[], f: PickerFilter): PickerModel[] {
  if (f === 'all') return models;
  if (f === 'recommended') return models.filter((m) => m.recommended);
  return models.filter((m) => m.kinds?.includes(f));
}

/** "128K context" from a token count. */
export function contextLabel(tokens: number | undefined): string | null {
  if (!tokens || tokens < 1_000) return null;
  return tokens >= 1_000_000 ? `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, '')}M context` : `${Math.round(tokens / 1_000)}K context`;
}

/** Models whose name, provider or description has every word of the query. */
export function matchModels(models: PickerModel[], query: string): PickerModel[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return models;
  return models.filter((m) => {
    const hay = `${m.name} ${m.provider} ${m.description} ${GROUP_LABELS[m.group] ?? ''}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

interface Props {
  models: PickerModel[];
  value: string;
  onChange(id: string): void;
  disabled?: boolean;
}

export function ModelPicker({ models, value, onChange, disabled }: Props): ReactNode {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<PickerFilter>('all');
  const button = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const id = useId();
  const close = (focus = true) => {
    setOpen(false);
    setQuery('');
    setFilter('all');
    if (focus) button.current?.focus();
  };
  useDismiss(open, () => close(false), [button, pop]);
  const current = models.find((m) => m.id === value);
  const label = value === 'auto' || !current ? 'Auto' : current.name;
  const searchable = models.length > SEARCH_FROM;
  // Only filters some model has (an older Worker sends no capabilities: no chips).
  const filters = FILTERS.filter((f) => f === 'all' || filterModels(models, f).length > 0);
  const shown = filterModels(matchModels(models, query), filter);
  const groups = [...new Set(shown.map((m) => m.group))];

  const choose = (m: string, enabled: boolean) => {
    if (!enabled) return;
    onChange(m);
    close();
  };
  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveFocus(list.current, '[role="option"]', 1); }
    else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const first = list.current?.querySelector('[role="option"]:not([aria-disabled="true"])');
      if (searchable && document.activeElement === first) search.current?.focus();
      else moveFocus(list.current, '[role="option"]', -1);
    }
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
        <div ref={pop} className={`vx-ai-pop vx-ai-picker-list${searchable ? ' has-search' : ''}`}>
          {searchable && (
            <input
              ref={search}
              type="search"
              className="vx-ai-picker-search"
              placeholder={`Search ${models.length} models`}
              aria-label="Search models"
              aria-controls={`${id}-list`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); moveFocus(list.current, '[role="option"]', 'first'); }
                else if (e.key === 'Enter') {
                  e.preventDefault();
                  const first = shown.find((m) => m.available);
                  if (first && query.trim()) choose(first.id, true);
                }
              }}
            />
          )}
          {filters.length > 1 && (
            <div className="vx-ai-picker-filters" role="group" aria-label="Filter models">
              {filters.map((f) => (
                <button key={f} type="button" className={`vx-ai-filter${filter === f ? ' is-on' : ''}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                  {FILTER_LABELS[f]}
                </button>
              ))}
            </div>
          )}
          <div ref={list} id={`${id}-list`} role="listbox" aria-label="Choose a model" className="vx-ai-picker-options" onKeyDown={onListKey}>
            {!query.trim() && filter === 'all' && option('auto', 'Auto', 'Picks a model for each message, and moves on if one is busy', [], true)}
            {groups.map((g) => (
              <div key={g} role="group" aria-labelledby={`${id}-${g}`}>
                <div id={`${id}-${g}`} className="vx-ai-pop-head">{GROUP_LABELS[g] ?? g}</div>
                {shown.filter((m) => m.group === g).map((m) =>
                  option(m.id, m.name, [m.description, m.provider, contextLabel(m.contextTokens)].filter(Boolean).join(' · '), badgesOf(m), m.available, m.available ? undefined : REASONS[m.reason ?? 'not_configured']),
                )}
              </div>
            ))}
            {!shown.length && <p className="vx-ai-picker-empty" role="status">{query.trim() ? <>No model matches “{query.trim()}”.</> : 'No model in this filter right now.'}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
