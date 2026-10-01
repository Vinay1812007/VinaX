import { CheckIcon } from '@/components/Icons';

export type StepState = 'done' | 'current' | 'upcoming' | 'error';

export interface Step {
  title: string;
  note?: string;
  state: StepState;
}

const SPOKEN: Record<StepState, string> = { done: 'done', current: 'current step', upcoming: 'not started', error: 'needs attention' };

/**
 * 9.0 — a short numbered list of what happens, with each step's state said
 * in words as well as shown (a check, the Iris current mark, a danger ring),
 * so the state never rests on colour. Used by Move to a new device and
 * Listen Together. Styled in styles/pages/secondary.css.
 */
export function StepList({ steps, label }: { steps: Step[]; label: string }) {
  return (
    <ol className="vx-steps" aria-label={label}>
      {steps.map((s, i) => (
        <li key={s.title} className="vx-step" data-state={s.state} aria-current={s.state === 'current' ? 'step' : undefined}>
          <span className="vx-step-mark" aria-hidden>
            {s.state === 'done' ? <CheckIcon className="w-4 h-4" /> : i + 1}
          </span>
          <span className="vx-step-text">
            <span className="vx-step-title">
              {s.title}
              <span className="sr-only">, {SPOKEN[s.state]}</span>
            </span>
            {s.note && <span className="vx-step-note">{s.note}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}
