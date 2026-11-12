/**
 * VinaX AI — thinking levels: what the composer's Thinking choice (Auto,
 * Fast, Standard, Extended, Maximum) means for each model, and how Auto
 * judges a message's difficulty.
 *
 * A level is only offered where the provider has a real switch for it:
 *   - Gemini 3 (`thinkingConfig.thinkingLevel`): Fast = minimal, Standard =
 *     low, Extended = high, Maximum = high with twice the output room
 *     (Gemini counts thinking against `maxOutputTokens`, so more room is more
 *     thinking before the answer is cut off).
 *   - GPT-OSS on Groq (`reasoning_effort`): Fast = low, Standard = medium,
 *     Extended = high. No level above high, so no Maximum.
 *   - OpenRouter reasoning models (OpenRouter's own `reasoning.effort`):
 *     Fast = low, Standard = the model's default, Extended = high.
 *   - Any other model with `highParams`: Standard and Extended.
 *   - Everything else (NVIDIA, Workers AI, models without a switch):
 *     Standard only. Asking such a model for another level answers at
 *     Standard, and the page is told (meta `thinking: { asked, used }`).
 *
 * Auto judges difficulty with cheap text cues, never an extra model call.
 */
import { hasCodeCues, isSmallTalk } from './router';
import type { ModelSpec } from './types';

export type ThinkingLevel = 'fast' | 'standard' | 'extended' | 'max';
export type ThinkingChoice = 'auto' | ThinkingLevel;
export const THINKING_LEVELS: readonly ThinkingLevel[] = ['fast', 'standard', 'extended', 'max'];
export const THINKING_NAMES: Record<ThinkingLevel, string> = { fast: 'Fast', standard: 'Standard', extended: 'Extended', max: 'Maximum' };

/** Output room at Maximum on Gemini 3 (the 3.x Flash models' published ceiling). */
export const MAX_THINKING_OUTPUT = 65_536;

interface Profile {
  /** Supported levels, lowest first; always includes 'standard'. */
  levels: ThinkingLevel[];
  /** Request fields per level, laid over the model's own `params`. */
  params: Partial<Record<ThinkingLevel, Record<string, unknown>>>;
  /** Output room per level, when it differs from the model's `maxOutput`. */
  output: Partial<Record<ThinkingLevel, number>>;
}

const geminiLevel = (thinkingLevel: string) => ({ thinkingConfig: { includeThoughts: true, thinkingLevel } });

export function thinkingProfile(spec: Pick<ModelSpec, 'provider' | 'upstream' | 'flags' | 'highParams' | 'maxOutput'>): Profile {
  if (spec.provider === 'gemini' && /^gemini-3/.test(spec.upstream) && spec.flags.reasoning) {
    return {
      levels: ['fast', 'standard', 'extended', 'max'],
      params: { fast: geminiLevel('minimal'), standard: geminiLevel('low'), extended: geminiLevel('high'), max: geminiLevel('high') },
      output: { max: Math.max(spec.maxOutput, MAX_THINKING_OUTPUT) },
    };
  }
  if (spec.provider === 'groq' && /gpt-oss/.test(spec.upstream)) {
    return {
      levels: ['fast', 'standard', 'extended'],
      params: { fast: { reasoning_effort: 'low' }, standard: { reasoning_effort: 'medium' }, extended: { reasoning_effort: 'high' } },
      output: {},
    };
  }
  if (spec.provider === 'openrouter' && spec.flags.reasoning) {
    return {
      levels: ['fast', 'standard', 'extended'],
      params: { fast: { reasoning: { effort: 'low' } }, extended: { reasoning: { effort: 'high' } } },
      output: {},
    };
  }
  if (spec.highParams) return { levels: ['standard', 'extended'], params: { extended: spec.highParams }, output: {} };
  return { levels: ['standard'], params: {}, output: {} };
}

export const levelsOf = (spec: Parameters<typeof thinkingProfile>[0]): ThinkingLevel[] => thinkingProfile(spec).levels;

/** The nearest level this model has: Maximum falls to Extended, anything else to Standard. */
export function resolveLevel(spec: Parameters<typeof thinkingProfile>[0], asked: ThinkingLevel): ThinkingLevel {
  const levels = levelsOf(spec);
  if (levels.includes(asked)) return asked;
  if (asked === 'max' && levels.includes('extended')) return 'extended';
  return 'standard';
}

/**
 * The model as it should be asked at a level: its params with the level's
 * fields laid over them, and the level's output room. Adapters then send it
 * with reasoning 'default' (the level is already in the params).
 */
export function specAtLevel<T extends ModelSpec>(spec: T, level: ThinkingLevel): T {
  const p = thinkingProfile(spec);
  const extra = p.params[level];
  const output = p.output[level];
  if (!extra && !output) return spec;
  return { ...spec, params: { ...(spec.params ?? {}), ...(extra ?? {}) }, ...(output ? { maxOutput: output } : {}) };
}

/** The composer's choice from a request body; the old `extendedThinking: true` means Extended. */
export function parseThinking(raw: unknown, extendedThinking: unknown): ThinkingChoice {
  if (raw === 'auto' || (typeof raw === 'string' && (THINKING_LEVELS as readonly string[]).includes(raw))) return raw as ThinkingChoice;
  return extendedThinking === true ? 'extended' : 'auto';
}

export type TaskKind = 'chat' | 'code' | 'math' | 'analysis' | 'writing' | 'vision' | 'document';
export type Complexity = 'simple' | 'normal' | 'hard';

export interface TaskSignals {
  text: string;
  hasImages: boolean;
  hasPdf: boolean;
}

export interface TaskAssessment {
  kind: TaskKind;
  complexity: Complexity;
}

const MATH_CUES = /\b(?:prove|proof|integral|integrate|derivative|differentiat|equation|solve for|simplify|factori[sz]e|probability|theorem|lemma|matrix|eigen|polynomial|limit of|series|modulo|combinatoric|permutation|calculus|algebra|geometry|trigonometr|logarithm)\b|[∫∑√π≤≥≠]|\b\d+\s*[\^*/×÷]\s*\d+|\b[a-z]\s*\^\s*\d|=\s*0\b/i;
const HARD_CUES = /\bstep[- ]by[- ]step\b|\bin depth\b|\bthorough(?:ly)?\b|\brigorous(?:ly)?\b|\banaly[sz]e\b|\bcompare\b|\btrade-?offs?\b|\barchitect(?:ure)?\b|\boptimi[sz]e\b|\brefactor\b|\bdesign (?:a|an|the)\b|\bplan (?:a|an|my|the)\b|\bresearch\b|\bwhy (?:does|do|is|are)\b|\bexplain how\b|\bdebug\b|\broot cause\b|\bedge cases?\b|\bpros and cons\b|\bimplement\b|\bfrom scratch\b|\bprove\b/i;
const MATH_WORK = /\b(?:solve|prove|derive|show that|find all|minimi[sz]e|maximi[sz]e)\b|=|[∫∑]/i;
const FACT_QUESTION = /^(?:what|who|when|where|which|how (?:many|much|old|far|tall|long)|is|are|was|were|does|do|did|can)\b/i;
const WRITING_CUES = /\b(?:write|draft|rewrite|essay|story|poem|letter|email|cover letter|blog|article|summari[sz]e|translate|lyrics)\b/i;
const ANALYSIS_CUES = /\b(?:analy[sz]e|compare|evaluate|assess|review|critique|pros and cons|trade-?offs?|research|investigate)\b/i;

/** What kind of message this is and how hard it looks, from the text alone. */
export function assessTask(s: TaskSignals): TaskAssessment {
  const t = s.text.trim();
  const words = t ? t.split(/\s+/).length : 0;
  const questions = (t.match(/\?/g) ?? []).length;
  const listed = (t.match(/^\s*(?:\d+[.)]|[-*•])\s+/gm) ?? []).length;
  const code = hasCodeCues(t);
  const math = MATH_CUES.test(t);
  const kind: TaskKind = s.hasImages ? 'vision'
    : s.hasPdf ? 'document'
      : code ? 'code'
        : math ? 'math'
          : ANALYSIS_CUES.test(t) ? 'analysis'
            : WRITING_CUES.test(t) ? 'writing'
              : 'chat';
  let score = 0;
  if (HARD_CUES.test(t)) score += 2;
  // Working to do (solve, prove, an equation, several operations) is hard; naming a maths topic is not.
  if (math) score += MATH_WORK.test(t) || (t.match(/\d\s*[-+*/^×÷]\s*\d/g) ?? []).length >= 2 ? 3 : 1;
  if (code && t.length > 1_200) score += 1;
  if (code && /\b(?:bug|error|exception|traceback|stack ?trace|fails?|crash|wrong)\b/i.test(t)) score += 1;
  // A multi-part request: three or more questions or listed requirements.
  if (Math.max(questions, listed) >= 3) score += 3;
  if (words > 150) score += 1;
  if (s.hasPdf && words > 12) score += 1;
  if (score >= 3) return { kind, complexity: 'hard' };
  // Small talk, and short fact questions ("What is the capital of France?").
  const fact = words <= 10 && FACT_QUESTION.test(t) && questions === 1 && !code && !math && !s.hasImages && !s.hasPdf && score === 0;
  if (!t || isSmallTalk(t) || fact) return { kind, complexity: 'simple' };
  return { kind, complexity: 'normal' };
}

/** Auto's level for a message: simple ones answer fast, hard ones think longer. */
export const autoLevel = (a: TaskAssessment): ThinkingLevel => (a.complexity === 'simple' ? 'fast' : a.complexity === 'hard' ? 'extended' : 'standard');

/**
 * Auto model, Extended or Maximum: full-size models that can think longer go
 * first (those with the exact level ahead of those with the nearest one), in
 * their ladder order, so a hard question reaches a model with a real switch
 * before one without. A small (fast-tier) model is never moved up for this.
 * The rest stay behind them as failover. Fast and Standard keep the ladder's
 * order: its first models are already the quick ones.
 */
export function preferLevel(candidates: readonly ModelSpec[], level: ThinkingLevel): ModelSpec[] {
  if (level === 'standard' || level === 'fast') return candidates.slice();
  const deep = (c: ModelSpec) => c.tier === 'full' && levelsOf(c).some((l) => l === 'extended' || l === 'max');
  const strong = candidates.filter(deep);
  const exact = strong.filter((c) => levelsOf(c).includes(level));
  return [...exact, ...strong.filter((c) => !exact.includes(c)), ...candidates.filter((c) => !strong.includes(c))];
}

/**
 * The levels Auto (model) can really give, from the models in its chat
 * ladders: Fast and Standard always; Extended or Maximum only when a
 * full-size ladder model has that switch. The picker says so before sending.
 */
export function autoLevels(ladderModels: readonly ModelSpec[]): ThinkingLevel[] {
  const out: ThinkingLevel[] = ['fast', 'standard'];
  for (const l of ['extended', 'max'] as const) if (ladderModels.some((m) => m.tier === 'full' && levelsOf(m).includes(l))) out.push(l);
  return out;
}

/** Why Auto routed this way, in a few words for the page ("Coding · hard"). */
export const TASK_NAMES: Record<TaskKind, string> = {
  chat: 'Conversation', code: 'Coding', math: 'Maths', analysis: 'Analysis', writing: 'Writing', vision: 'Image', document: 'Document',
};
