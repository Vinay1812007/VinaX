/**
 * VinaX AI — the two interactive blocks the visuals prompt asks for:
 *
 *   ```questions  [{"question": "…", "options": ["…", "…"]}]
 *       up to three clarifying questions as clickable choices; the answers
 *       go back as the listener's next message (only on the latest reply);
 *   ```quiz  [{"question": "…", "options": […], "answer": "…", "explanation": "…"}]
 *       a quiz played right in the reply: one question at a time, the right
 *       answer and the explanation after each pick, a score at the end.
 *
 * Model output is untrusted: the JSON is parsed (never run), every field is
 * checked and capped, and anything that doesn't parse shows as plain code.
 */
import { createContext, useContext, useId, useMemo, useState, type ReactNode } from 'react';
import { CodeBlock } from './CodeBlock';
import { CheckIcon, CloseIcon, ContinueIcon, RetryIcon } from './icons';

/** What a block in a reply may do: answer (the latest reply only), and whether the reply is still being written. */
export interface ReplyActions {
  live: boolean;
  answer?(text: string): void;
}
export const ReplyActionsContext = createContext<ReplyActions>({ live: false });

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** JSON a model wrote: trailing commas forgiven, and an object holding the list unwrapped. */
export function parseBlockJson(text: string): unknown[] | null {
  const raw = text.trim();
  if (!raw) return null;
  let v: unknown;
  try { v = JSON.parse(raw); } catch {
    try { v = JSON.parse(raw.replace(/,\s*([\]}])/g, '$1')); } catch { return null; }
  }
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') {
    const list = Object.values(v as Record<string, unknown>).find(Array.isArray);
    if (list) return list as unknown[];
    return [v];
  }
  return null;
}

export interface Question { question: string; options: string[] }
export interface QuizItem { question: string; options: string[]; answer: number; explanation: string }

export function toQuestions(list: unknown[] | null): Question[] {
  return (list ?? []).slice(0, 5).flatMap((q) => {
    const o = q as { question?: unknown; options?: unknown };
    const question = str(o?.question, 300);
    const options = Array.isArray(o?.options) ? o.options.map((x) => str(x, 140)).filter(Boolean).slice(0, 8) : [];
    return question ? [{ question, options }] : [];
  });
}

/** Which option is right: the answer's text, its letter ("B", "b)") or its number. -1 when it can't be told. */
export function answerIndex(options: string[], answer: unknown): number {
  if (typeof answer === 'number' && Number.isInteger(answer)) return answer >= 0 && answer < options.length ? answer : -1;
  const a = str(answer, 300).toLowerCase();
  if (!a) return -1;
  const exact = options.findIndex((o) => o.toLowerCase() === a);
  if (exact >= 0) return exact;
  const letter = /^([a-h])[).:]?$/.exec(a) ?? /^([a-h])[).:]\s/.exec(a);
  if (letter) { const i = letter[1].charCodeAt(0) - 97; if (i < options.length) return i; }
  const loose = options.findIndex((o) => o.toLowerCase().includes(a) || a.includes(o.toLowerCase()));
  return loose;
}

export function toQuiz(list: unknown[] | null): QuizItem[] {
  return (list ?? []).slice(0, 30).flatMap((q) => {
    const o = q as { question?: unknown; options?: unknown; answer?: unknown; explanation?: unknown };
    const question = str(o?.question, 400);
    const options = Array.isArray(o?.options) ? o.options.map((x) => str(x, 200)).filter(Boolean).slice(0, 8) : [];
    if (!question || options.length < 2) return [];
    return [{ question, options, answer: answerIndex(options, o?.answer), explanation: str(o?.explanation, 900) }];
  });
}

const LETTERS = 'ABCDEFGH';

function Writing({ what }: { what: string }): ReactNode {
  return (
    <div className="vx-ai-card-block is-writing" role="status">
      <span className="vx-ai-shimmer">{what}…</span>
    </div>
  );
}

// ---------------------------------------------------------------- questions

export function QuestionsBlock({ text }: { text: string }): ReactNode {
  const { live, answer } = useContext(ReplyActionsContext);
  const questions = useMemo(() => toQuestions(parseBlockJson(text)), [text]);
  const [picked, setPicked] = useState<Record<number, string>>({});
  const [other, setOther] = useState<Record<number, string>>({});
  const [sent, setSent] = useState(false);
  const uid = useId();
  if (!questions.length) return live ? <Writing what="Writing a few questions" /> : <CodeBlock code={text} lang="json" />;
  const can = !!answer && !sent && !live;
  const valueOf = (i: number) => (other[i]?.trim() || picked[i] || '').trim();
  const answered = questions.filter((_, i) => valueOf(i)).length;
  const submit = (override?: Record<number, string>) => {
    if (!answer) return;
    const v = (i: number) => (override?.[i] ?? valueOf(i));
    const lines = questions.length === 1
      ? [v(0)]
      : questions.flatMap((q, i) => (v(i) ? [`${q.question} — ${v(i)}`] : []));
    if (!lines.join('').trim()) return;
    setSent(true);
    answer(lines.join('\n'));
  };
  const choose = (i: number, opt: string) => {
    if (!can) return;
    setPicked((p) => ({ ...p, [i]: opt }));
    setOther((o) => ({ ...o, [i]: '' }));
    // One question: a tap is the answer.
    if (questions.length === 1) submit({ 0: opt });
  };
  return (
    <div className={`vx-ai-card-block vx-ai-questions${sent ? ' is-sent' : ''}`} role="group" aria-label="Questions from VinaX AI">
      {questions.map((q, i) => (
        <div key={i} className={`vx-ai-q${can ? '' : ' is-locked'}`} role="group" aria-labelledby={`${uid}-q${i}`}>
          <p className="vx-ai-q-title" id={`${uid}-q${i}`}>{questions.length > 1 && <span className="vx-ai-q-n" aria-hidden>{i + 1}</span>}{q.question}</p>
          <div className="vx-ai-q-options">
            {q.options.map((opt) => (
              <button key={opt} type="button" className="vx-ai-q-opt" disabled={!can} aria-pressed={picked[i] === opt && !other[i]?.trim()} onClick={() => choose(i, opt)}>
                {picked[i] === opt && !other[i]?.trim() && <CheckIcon className="w-4 h-4" />}
                {opt}
              </button>
            ))}
          </div>
          {can && (
            <input
              className="vx-ai-q-other"
              value={other[i] ?? ''}
              placeholder={q.options.length ? 'Or type your own answer' : 'Type your answer'}
              aria-label={`Your own answer to: ${q.question}`}
              onChange={(e) => setOther((o) => ({ ...o, [i]: e.target.value }))}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
            />
          )}
        </div>
      ))}
      {can && (questions.length > 1 || other[0]?.trim() || !questions[0].options.length) && (
        <div className="vx-ai-q-foot">
          <span className="vx-ai-q-count">{answered} of {questions.length} answered</span>
          <button type="button" className="vx-ai-chip is-primary" disabled={!answered} onClick={() => submit()}>
            Send answers <ContinueIcon className="w-4 h-4" />
          </button>
        </div>
      )}
      {sent && <p className="vx-ai-q-sent"><CheckIcon className="w-4 h-4" /> Answers sent</p>}
    </div>
  );
}

// --------------------------------------------------------------------- quiz

export function QuizBlock({ text }: { text: string }): ReactNode {
  const { live } = useContext(ReplyActionsContext);
  const items = useMemo(() => toQuiz(parseBlockJson(text)), [text]);
  const [at, setAt] = useState(0);
  const [picks, setPicks] = useState<number[]>([]);
  if (!items.length) return live ? <Writing what="Writing the quiz" /> : <CodeBlock code={text} lang="json" />;
  if (live) return <Writing what={`Writing the quiz · ${items.length} question${items.length === 1 ? '' : 's'} so far`} />;
  const done = at >= items.length;
  const score = picks.reduce((n, p, i) => n + (items[i] && p === items[i].answer ? 1 : 0), 0);
  const restart = () => { setPicks([]); setAt(0); };
  if (done) {
    const pct = Math.round((score / items.length) * 100);
    const note = pct === 100 ? 'Perfect score!' : pct >= 70 ? 'Nicely done.' : pct >= 40 ? 'Good effort, keep going.' : 'Worth another try.';
    return (
      <div className="vx-ai-card-block vx-ai-quiz is-done" role="group" aria-label="Quiz result">
        <div className="vx-ai-quiz-score" style={{ ['--pct' as string]: `${pct}` }}>
          <svg viewBox="0 0 120 120" aria-hidden>
            <circle cx="60" cy="60" r="52" className="vx-ai-quiz-track" />
            <circle cx="60" cy="60" r="52" className="vx-ai-quiz-arc" pathLength={100} style={{ strokeDasharray: `${pct} 100` }} />
          </svg>
          <span><strong>{score}</strong>/{items.length}</span>
        </div>
        <p className="vx-ai-quiz-note">{note}</p>
        <ol className="vx-ai-quiz-review">
          {items.map((q, i) => (
            <li key={i} className={picks[i] === q.answer ? 'is-right' : 'is-wrong'}>
              {picks[i] === q.answer ? <CheckIcon className="w-4 h-4" /> : <CloseIcon className="w-4 h-4" />}
              <span>{q.question}{q.answer >= 0 && picks[i] !== q.answer && <em> — {q.options[q.answer]}</em>}</span>
            </li>
          ))}
        </ol>
        <button type="button" className="vx-ai-chip" onClick={restart}><RetryIcon className="w-4 h-4" /> Try again</button>
      </div>
    );
  }
  const q = items[at];
  const pick = picks[at];
  const answered = pick != null;
  return (
    <div className="vx-ai-card-block vx-ai-quiz" role="group" aria-label={`Quiz, question ${at + 1} of ${items.length}`}>
      <div className="vx-ai-quiz-head">
        <span>Question {at + 1} of {items.length}</span>
        <span className="vx-ai-quiz-progress" aria-hidden><span style={{ width: `${((at + (answered ? 1 : 0)) / items.length) * 100}%` }} /></span>
      </div>
      <p className="vx-ai-quiz-q" key={`q${at}`}>{q.question}</p>
      <div className="vx-ai-quiz-options" key={`o${at}`}>
        {q.options.map((opt, i) => {
          const state = !answered ? '' : i === q.answer ? ' is-right' : i === pick ? ' is-wrong' : ' is-dim';
          return (
            <button
              key={i}
              type="button"
              className={`vx-ai-quiz-opt${state}`}
              style={{ ['--i' as string]: i }}
              disabled={answered}
              aria-pressed={pick === i}
              onClick={() => setPicks((p) => { const n = [...p]; n[at] = i; return n; })}
            >
              <span className="vx-ai-quiz-letter" aria-hidden>{answered && i === q.answer ? <CheckIcon className="w-4 h-4" /> : answered && i === pick ? <CloseIcon className="w-4 h-4" /> : LETTERS[i]}</span>
              <span>{opt}</span>
            </button>
          );
        })}
      </div>
      {answered && (
        <div className={`vx-ai-quiz-why${pick === q.answer || q.answer < 0 ? ' is-right' : ' is-wrong'}`} role="status">
          <strong>{q.answer < 0 ? 'Answer noted.' : pick === q.answer ? 'Correct!' : `Not quite. The answer is ${LETTERS[q.answer]}.`}</strong>
          {q.explanation && <span> {q.explanation}</span>}
        </div>
      )}
      <div className="vx-ai-quiz-foot">
        {answered && (
          <button type="button" className="vx-ai-chip is-primary" onClick={() => setAt(at + 1)}>
            {at + 1 < items.length ? 'Next question' : 'See your score'} <ContinueIcon className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
