/**
 * VinaX AI — thinking levels (thinking.ts): which levels each provider really
 * has, the nearest-level fallback, the params each level sends, how Auto
 * judges difficulty, and the capability order inside a ladder (router.ts).
 */
import { describe, expect, it } from 'vitest';
import { MODELS, modelById } from '../functions/_lib/ai/models';
import { preferFit } from '../functions/_lib/ai/router';
import {
  assessTask, autoLevel, levelsOf, MAX_THINKING_OUTPUT, parseThinking, preferLevel, resolveLevel, specAtLevel,
} from '../functions/_lib/ai/thinking';
import { buildSystemPrompt } from '../functions/_lib/ai/prompt';
import type { ModelSpec } from '../functions/_lib/ai/types';

const spec = (id: string): ModelSpec => {
  const s = modelById(MODELS, id);
  if (!s) throw new Error(`no ${id}`);
  return s;
};
const GEMINI = spec('gemini:gemini-3.6-flash');
const GROQ = spec('groq:openai/gpt-oss-120b');
const NVIDIA = spec('nvidia:deepseek-ai/deepseek-v4.1-flash');
const LITE = spec('gemini:gemini-3.1-flash-lite');
const CF = spec('cloudflare:@cf/openai/gpt-oss-120b');

describe('levels per provider', () => {
  it('Gemini 3 has all four; GPT-OSS on Groq has three; NVIDIA and Workers AI only Standard', () => {
    expect(levelsOf(GEMINI)).toEqual(['fast', 'standard', 'extended', 'max']);
    expect(levelsOf(GROQ)).toEqual(['fast', 'standard', 'extended']);
    expect(levelsOf(NVIDIA)).toEqual(['standard']);
    expect(levelsOf(CF)).toEqual(['standard']);
  });

  it('OpenRouter reasoning models use OpenRouter’s reasoning.effort; non-reasoning ones get no switch', () => {
    const or = MODELS.find((m) => m.provider === 'openrouter' && m.flags.reasoning)!;
    expect(levelsOf(or)).toEqual(['fast', 'standard', 'extended']);
    expect(specAtLevel(or, 'extended').params).toMatchObject({ reasoning: { effort: 'high' } });
    const plain = MODELS.find((m) => m.provider === 'openrouter' && !m.flags.reasoning);
    if (plain) expect(levelsOf(plain)).toEqual(['standard']);
  });

  it('every model has Standard, and every level a model lists is one of the four', () => {
    for (const m of MODELS) {
      const l = levelsOf(m);
      expect(l).toContain('standard');
      for (const x of l) expect(['fast', 'standard', 'extended', 'max']).toContain(x);
    }
  });

  it('falls back to the nearest level: Maximum → Extended → Standard, Fast → Standard', () => {
    expect(resolveLevel(GROQ, 'max')).toBe('extended');
    expect(resolveLevel(NVIDIA, 'max')).toBe('standard');
    expect(resolveLevel(NVIDIA, 'fast')).toBe('standard');
    expect(resolveLevel(GEMINI, 'max')).toBe('max');
  });
});

describe('params per level', () => {
  it('Gemini: minimal / low / high, and Maximum doubles the output room', () => {
    expect(specAtLevel(GEMINI, 'fast').params).toMatchObject({ thinkingConfig: { includeThoughts: true, thinkingLevel: 'minimal' } });
    expect(specAtLevel(GEMINI, 'standard').params).toMatchObject({ thinkingConfig: { thinkingLevel: 'low' } });
    expect(specAtLevel(GEMINI, 'extended').params).toMatchObject({ thinkingConfig: { thinkingLevel: 'high' } });
    expect(specAtLevel(GEMINI, 'extended').maxOutput).toBe(GEMINI.maxOutput);
    expect(specAtLevel(GEMINI, 'max').maxOutput).toBe(MAX_THINKING_OUTPUT);
    expect(specAtLevel(LITE, 'max').maxOutput).toBe(32_768);
  });

  it('Groq GPT-OSS: reasoning_effort low / medium / high, keeping include_reasoning', () => {
    expect(specAtLevel(GROQ, 'fast').params).toEqual({ include_reasoning: true, reasoning_effort: 'low' });
    expect(specAtLevel(GROQ, 'standard').params).toEqual({ include_reasoning: true, reasoning_effort: 'medium' });
    expect(specAtLevel(GROQ, 'extended').params).toEqual({ include_reasoning: true, reasoning_effort: 'high' });
  });

  it('a model without a switch is sent unchanged', () => {
    expect(specAtLevel(NVIDIA, 'standard')).toBe(NVIDIA);
  });

  it('the request field: a level name, else Auto', () => {
    expect(parseThinking('max')).toBe('max');
    expect(parseThinking('extended')).toBe('extended');
    expect(parseThinking('nonsense')).toBe('auto');
    expect(parseThinking(undefined)).toBe('auto');
  });
});

describe('Auto’s judgement', () => {
  const at = (text: string, extra: Partial<{ hasImages: boolean; hasPdf: boolean }> = {}) => assessTask({ text, hasImages: false, hasPdf: false, ...extra });

  it('greetings and short questions are simple (Fast)', () => {
    expect(at('hi')).toEqual({ kind: 'chat', complexity: 'simple' });
    expect(autoLevel(at('thanks!'))).toBe('fast');
    expect(at('What is the capital of France?').complexity).toBe('simple');
  });

  it('maths, step-by-step work and multi-part questions are hard (Extended)', () => {
    expect(at('Solve for x: 3x^2 + 2x - 5 = 0 and explain each step')).toMatchObject({ kind: 'math', complexity: 'hard' });
    expect(autoLevel(at('Prove that the square root of 2 is irrational'))).toBe('extended');
    expect(at('1. What is a monad?\n2. How does it differ from a functor?\n3. Give an example in Haskell.\n4. When should I avoid it?').complexity).toBe('hard');
  });

  it('a stack trace with a bug report is hard code; a short code question is normal', () => {
    const trace = `My app crashes with this error:\nTypeError: Cannot read properties of undefined (reading 'map')\n    at List (List.tsx:12:20)\nWhy does it fail and how do I debug it?`;
    expect(at(trace)).toMatchObject({ kind: 'code', complexity: 'hard' });
    expect(at('How do I reverse a list in Python with a function?')).toMatchObject({ kind: 'code', complexity: 'normal' });
  });

  it('images and PDFs set the kind', () => {
    expect(at('what is this?', { hasImages: true }).kind).toBe('vision');
    expect(at('summarise the key findings of this report for me please', { hasPdf: true }).kind).toBe('document');
  });

  it('ordinary requests are normal (Standard)', () => {
    expect(autoLevel(at('Tell me about raga Yaman'))).toBe('standard');
    expect(at('Write a short poem about the monsoon in Kerala').kind).toBe('writing');
  });
});

describe('ordering candidates', () => {
  it('Extended and Maximum put models that have the level first; Fast and Standard keep the ladder', () => {
    const ladder = [NVIDIA, GROQ, CF, GEMINI];
    expect(preferLevel(ladder, 'max').map((m) => m.id)).toEqual([GEMINI.id, GROQ.id, NVIDIA.id, CF.id]);
    expect(preferLevel(ladder, 'extended').map((m) => m.id)).toEqual([GROQ.id, GEMINI.id, NVIDIA.id, CF.id]);
    expect(preferLevel(ladder, 'fast')).toEqual(ladder);
  });

  it('a small model is never moved up for Maximum, even though it has the switch', () => {
    expect(levelsOf(LITE)).toContain('max');
    expect(preferLevel([NVIDIA, GROQ, LITE], 'max').map((m) => m.id)).toEqual([GROQ.id, NVIDIA.id, LITE.id]);
  });

  it('autoLevels: Extended and Maximum only when a full-size ladder model has them', async () => {
    const { autoLevels } = await import('../functions/_lib/ai/thinking');
    expect(autoLevels([NVIDIA, LITE])).toEqual(['fast', 'standard']);
    expect(autoLevels([NVIDIA, GROQ, LITE])).toEqual(['fast', 'standard', 'extended']);
    expect(autoLevels([GEMINI])).toEqual(['fast', 'standard', 'extended', 'max']);
  });

  it('capabilities: only seeing models for images, and models that hold the thread first', () => {
    const vl = spec('nvidia:nvidia/nemotron-3.5-super-vl-120b-a12b');
    expect(preferFit([GROQ, vl, GEMINI], { hasImages: true, threadChars: 1_000 }).map((m) => m.id)).toEqual([vl.id, GEMINI.id]);
    expect(preferFit([GROQ, NVIDIA, GEMINI], { hasImages: false, threadChars: 200_000 }).map((m) => m.id)).toEqual([GEMINI.id, GROQ.id, NVIDIA.id]);
    expect(preferFit([GROQ, NVIDIA], { hasImages: true, threadChars: 10 }).map((m) => m.id)).toEqual([GROQ.id, NVIDIA.id]);
  });
});

describe('prompt', () => {
  const vars = { now: new Date('2026-11-12T10:00:00Z'), timezone: 'UTC', locale: 'en', firstName: 'Asha', modelName: 'X', providerName: 'Y' };
  it('Extended and Maximum ask for a checked answer; Fast and Standard add nothing', () => {
    const base = buildSystemPrompt({ spec: GEMINI, vars, artifacts: false });
    expect(buildSystemPrompt({ spec: GEMINI, vars, artifacts: false, thinking: 'standard' })).toBe(base);
    expect(buildSystemPrompt({ spec: GEMINI, vars, artifacts: false, thinking: 'fast' })).toBe(base);
    expect(buildSystemPrompt({ spec: GEMINI, vars, artifacts: false, thinking: 'extended' })).toContain('# Careful mode');
    expect(buildSystemPrompt({ spec: GEMINI, vars, artifacts: false, thinking: 'max' })).toContain('review the draft against every part of the question');
  });
});
