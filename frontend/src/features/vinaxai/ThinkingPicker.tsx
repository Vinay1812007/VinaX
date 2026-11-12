/**
 * VinaX AI — the composer's Thinking menu: Auto, Fast, Standard, Extended,
 * Maximum. Each level maps to a real switch at the provider (the Worker's
 * thinking.ts); a model without a level answers at the nearest one it has,
 * and the menu says so before sending, as the reply's footer does after.
 */
import { useRef, useState, type ReactNode } from 'react';
import { moveFocus, useDismiss } from './useDismiss';
import { ChevronDownSmallIcon, ThinkIcon } from './icons';
import { THINKING_CHOICES, type PickerModel, type ThinkingChoice, type ThinkingLevel } from './types';

export const THINKING_LABELS: Record<ThinkingChoice, string> = { auto: 'Auto', fast: 'Fast', standard: 'Standard', extended: 'Extended', max: 'Maximum' };
export const THINKING_NOTES: Record<ThinkingChoice, string> = {
  auto: 'Quick for simple messages, longer for hard ones',
  fast: 'Answers straight away with little thinking',
  standard: 'The model’s usual amount of thinking',
  extended: 'Thinks longer and checks its work',
  max: 'The most thinking room, then a final review',
};

/** The level a model answers at when asked for `asked` (the Worker's resolveLevel). */
export function nearestLevel(levels: readonly ThinkingLevel[] | undefined, asked: ThinkingLevel): ThinkingLevel {
  const have = levels?.length ? levels : ['standard'];
  if (have.includes(asked)) return asked;
  if (asked === 'max' && have.includes('extended')) return 'extended';
  return 'standard';
}

/**
 * Why a choice will not apply as asked: the picked model's nearest level, or
 * for Auto model the nearest level its ladders reach (`autoLevels`, from the
 * Worker) and a model to pick for the real thing. Null when it will apply.
 */
export function levelNote(choice: ThinkingChoice, model: PickerModel | null, models: readonly PickerModel[], autoLevels?: readonly ThinkingLevel[]): string | null {
  if (choice === 'auto' || choice === 'standard') return null;
  // An older Worker sends no levels: nothing is known, so nothing is claimed.
  if (model ? !model.thinkingLevels : !models.some((m) => m.thinkingLevels)) return null;
  if (!model) {
    const has = models.find((m) => m.available && m.thinkingLevels?.includes(choice));
    if (autoLevels?.length) {
      if (autoLevels.includes(choice)) return null;
      const used = nearestLevel(autoLevels, choice);
      return `Auto uses ${THINKING_LABELS[used]}${has ? `; pick ${has.name} for ${THINKING_LABELS[choice]}` : ''}`;
    }
    return has || !models.length ? null : `No model offers ${THINKING_LABELS[choice]} right now`;
  }
  const used = nearestLevel(model.thinkingLevels, choice);
  return used === choice ? null : `${model.name} uses ${THINKING_LABELS[used]}`;
}

interface Props {
  value: ThinkingChoice;
  onChange(v: ThinkingChoice): void;
  /** The composer's model: null = Auto. */
  model: PickerModel | null;
  models: readonly PickerModel[];
  /** The levels Auto can give (GET /api/ai/models `autoThinking`). */
  autoLevels?: readonly ThinkingLevel[];
  disabled?: boolean;
}

export function ThinkingPicker({ value, onChange, model, models, autoLevels, disabled }: Props): ReactNode {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const close = (focus = true) => {
    setOpen(false);
    if (focus) button.current?.focus();
  };
  useDismiss(open, () => close(false), [button, menu]);
  const choose = (v: ThinkingChoice) => {
    onChange(v);
    close();
  };
  const note = levelNote(value, model, models, autoLevels);
  return (
    <div className="vx-ai-thinkpick">
      <button
        ref={button}
        type="button"
        className={`vx-ai-thinkpick-btn${value === 'extended' || value === 'max' ? ' is-on' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Thinking: ${THINKING_LABELS[value]}${note ? ` (${note})` : ''}`}
        title={note ?? THINKING_NOTES[value]}
        disabled={disabled}
        onClick={() => {
          setOpen((o) => !o);
          requestAnimationFrame(() => {
            const sel = menu.current?.querySelector<HTMLElement>('[aria-checked="true"]');
            (sel ?? menu.current?.querySelector<HTMLElement>('[role="menuitemradio"]'))?.focus();
          });
        }}
      >
        <ThinkIcon className="w-4 h-4" />
        <span className="vx-ai-thinkpick-label">{THINKING_LABELS[value]}</span>
        {note && <span className="vx-ai-thinkpick-dot" aria-hidden />}
        <ChevronDownSmallIcon className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div
          ref={menu}
          role="menu"
          aria-label="Thinking"
          className="vx-ai-pop vx-ai-thinkpick-menu"
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); moveFocus(menu.current, '[role="menuitemradio"]', 1); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); moveFocus(menu.current, '[role="menuitemradio"]', -1); }
            else if (e.key === 'Escape') { e.preventDefault(); close(); }
            else if (e.key === 'Tab') close(false);
          }}
        >
          <div className="vx-ai-pop-head"><ThinkIcon className="w-3.5 h-3.5" /> Thinking</div>
          {THINKING_CHOICES.map((c) => {
            const n = levelNote(c, model, models, autoLevels);
            return (
              <div
                key={c}
                role="menuitemradio"
                aria-checked={value === c}
                tabIndex={-1}
                className="vx-ai-menu-item"
                onClick={() => choose(c)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(c); } }}
              >
                <span className={`vx-ai-radio${value === c ? ' is-on' : ''}`} aria-hidden />
                <span className="vx-ai-menu-text">
                  <span>{THINKING_LABELS[c]}</span>
                  <span className="vx-ai-opt-sub">{THINKING_NOTES[c]}</span>
                  {n && <span className="vx-ai-opt-sub vx-ai-thinkpick-note">{n}</span>}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
