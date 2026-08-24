/** Locks the auto-web-search trigger (v3.3.0): questions naming the CURRENT
 *  year must ground themselves in live results — the old 202[7-9] pattern
 *  quietly skipped 2026, so "best films of 2026" answered from stale memory. */
import { describe, expect, it } from 'vitest';
import { LANE_BY_MODE, needsFreshInfo } from './vinaxai';
import { LANE_MODEL } from '../_lib/ai';

describe('needsFreshInfo', () => {
  it('triggers on the current year (2026), not just future years', () => {
    expect(needsFreshInfo('what are the best telugu films of 2026?')).toBe(true);
    expect(needsFreshInfo('top releases 2027')).toBe(true);
  });

  it('triggers on classic recency phrasings', () => {
    expect(needsFreshInfo('who won the match today?')).toBe(true);
    expect(needsFreshInfo('latest AR Rahman album')).toBe(true);
    expect(needsFreshInfo('box office this week')).toBe(true);
  });

  it('stays off for timeless questions', () => {
    expect(needsFreshInfo('explain how a chorus differs from a refrain')).toBe(false);
    expect(needsFreshInfo('suggest calm telugu melodies')).toBe(false);
  });
});

/** Locks the v3.4.1 voice-latency fix: live-voice replies are spoken back, so
 *  first-token latency is everything. Voice was re-laned off the 550B home
 *  engine (~6.7 s to first token, measured live — a long silence after every
 *  spoken turn) onto the sub-second scholar lane (~0.5 s, measured live). Home
 *  must NEVER be voice's primary again without an owner-signed latency win. */
describe('voice reply lane (v3.4.1 latency fix)', () => {
  it('routes live-voice replies to the fast scholar lane, not the slow 550B home lane', () => {
    expect(LANE_BY_MODE.voice).toBe('scholar');
    expect(LANE_BY_MODE.voice).not.toBe('home');
  });

  it('the voice lane serves a fast external model, never the 550B ultra', () => {
    expect(LANE_MODEL[LANE_BY_MODE.voice]).toBe('llama-3.3-70b-versatile');
    expect(LANE_MODEL[LANE_BY_MODE.voice]).not.toContain('nemotron-3-ultra');
  });

  it('keeps nova (the powerful deep-answer seat) on the home lane — only voice moved', () => {
    expect(LANE_BY_MODE.nova).toBe('home');
  });
});

/**
 * 4.13.0 — the "productivity default" clause pushes every seat toward doing
 * over describing. This tests the SHAPE (all seats inherit it, refusal shape
 * still intact, prompt-injection guard still intact), so a well-meaning
 * future rewrite that drops the clause fails loudly instead of silently
 * softening the assistant.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('4.13 productivity persona', () => {
  const src = readFileSync(resolve(__dirname, './vinaxai.ts'), 'utf8');

  it('appends PRODUCTIVITY DEFAULT to the shared system prompt (all seats inherit it)', () => {
    expect(src).toContain('PRODUCTIVITY DEFAULT (v4.13)');
    expect(src).toMatch(/Bias toward doing, not describing/);
    expect(src).toMatch(/deliver the finished artifact first/);
  });

  it('keeps the refusal shape and prompt-injection guard downstream — clause is INSIDE the shared prompt', () => {
    const promptIdx = src.indexOf('PRODUCTIVITY DEFAULT (v4.13)');
    const injectIdx = src.indexOf('PROMPT INJECTION\n');
    const refuseIdx = src.indexOf('REFUSAL SHAPE');
    expect(promptIdx).toBeGreaterThan(refuseIdx);
    expect(injectIdx).toBeGreaterThan(promptIdx);
  });
});
